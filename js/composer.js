/* =====================================================================
   NOIR Studio — NO-THEORY COMPOSER  (headline feature)
   The easiest on-ramp: pick a vibe, optionally a key/tempo, hit Compose.
   We call the REAL MoodEngine.composeSong(...) and load the whole result
   (key + progression + riff + drum groove + tempo) into the rest of the
   app so the user can hear and tweak it.

   Reuses, never reinvents:
     MoodEngine.composeSong / moodNames / moodTags     → the engine
     App.setKey / App.startAudio / App.toast           → app-wide state + chrome
     Theory.voiceChord                                 → chord voicings
     AudioEngine.play                                  → audition / playback
     Riff.riff / render / renderEditor / _scheduleNotes → load the riff
     Looper.addTrack(name, events, loopLen)            → Studio tracks
   ===================================================================== */
(function (root) {
  "use strict";

  // Plain-language descriptions so a non-musician knows what each vibe feels
  // like. Keys must match MoodEngine.MOOD_TABLE keys. Any mood without an entry
  // here falls back to its tags.
  const MOOD_UI = {
    happy:       { emoji: "😄", blurb: "Bright, bouncy, feel-good." },
    sad:         { emoji: "😢", blurb: "Slow, heavy-hearted, blue." },
    melancholy:  { emoji: "🌧️", blurb: "Wistful and bittersweet." },
    tense:       { emoji: "😰", blurb: "On edge — something's coming." },
    peaceful:    { emoji: "🕊️", blurb: "Calm, gentle, easy breathing." },
    eerie:       { emoji: "👻", blurb: "Strange and unsettling." },
    aggressive:  { emoji: "🤘", blurb: "Loud, fast, in your face." },
    epic:        { emoji: "⚔️", blurb: "Huge, heroic, cinematic." },
    dreamy:      { emoji: "💭", blurb: "Floating, magical, otherworldly." },
    dark:        { emoji: "🦇", blurb: "Ominous, gothic, menacing." },
    romantic:    { emoji: "❤️", blurb: "Warm, tender, intimate." },
    hopeful:     { emoji: "🌅", blurb: "Rising, optimistic, determined." },
    groovy:      { emoji: "🕺", blurb: "Funky, rhythmic, in the pocket." },
    nostalgic:   { emoji: "📼", blurb: "Warm memories, faded photographs." },
    doom:        { emoji: "💀", blurb: "Crushing, slow, suffocating." },
    chase:       { emoji: "🏃", blurb: "Fast, frantic, adrenaline." },
    horror:      { emoji: "🔪", blurb: "Dread, fright, the reveal." },
    suspense:    { emoji: "🕵️", blurb: "Waiting, building, unresolved." },
    sunrise:     { emoji: "🌄", blurb: "Awakening, awe, a new beginning." },
    victory:     { emoji: "🏆", blurb: "Triumph, glory, the win." },
    grief:       { emoji: "🥀", blurb: "Mourning, loss, exposed and raw." },
    "love-scene":{ emoji: "🌹", blurb: "Cinematic romance, strings and all." },
  };

  const Composer = {
    app: null,
    mood: null,        // selected mood key
    song: null,        // last composed song object

    mount(app) {
      this.app = app;
      this.moodsEl   = document.getElementById("composer-moods");
      this.keySel    = document.getElementById("composer-key");
      this.tempoSel  = document.getElementById("composer-tempo");
      this.composeBtn= document.getElementById("composer-compose");
      this.playBtn   = document.getElementById("composer-play");
      this.resultEl  = document.getElementById("composer-result");
      if (!this.moodsEl) return;   // panel not present — bail safely

      this.buildMoods();
      this.buildKeySelect();

      this.composeBtn.addEventListener("click", () => this.compose());
      this.playBtn.addEventListener("click", () => this.play());

      // Theme/mood flip biases the default vibe so the toggle feels alive:
      // noir → pre-select a dark vibe, west → a bright one (only if user
      // hasn't already picked one).
      this.app.on("mood", (m) => this._biasDefault(m));
    },

    _moodList() {
      return (root.MoodEngine && MoodEngine.moodNames) ? MoodEngine.moodNames() : Object.keys(MOOD_UI);
    },

    buildMoods() {
      const tags = (root.MoodEngine && MoodEngine.moodTags) ? MoodEngine.moodTags() : {};
      this.moodsEl.innerHTML = "";
      this._moodList().forEach((name) => {
        const ui = MOOD_UI[name] || { emoji: "🎵", blurb: "" };
        const tagLine = (tags[name] || []).slice(0, 3).join(" · ");
        const card = document.createElement("button");
        card.className = "mood-card";
        card.dataset.mood = name;
        card.innerHTML =
          `<span class="mc-emoji">${ui.emoji}</span>
           <span class="mc-name">${name.replace("-", " ")}</span>
           <span class="mc-blurb">${ui.blurb}</span>
           ${tagLine ? `<span class="mc-tags">${tagLine}</span>` : ""}`;
        card.addEventListener("click", () => this.selectMood(name));
        this.moodsEl.appendChild(card);
      });
    },

    buildKeySelect() {
      if (!this.keySel || !root.Theory) return;
      Theory.ALL_ROOTS.forEach((r) => {
        const o = document.createElement("option");
        o.value = r; o.textContent = r;
        this.keySel.appendChild(o);
      });
    },

    selectMood(name) {
      this.mood = name;
      this.moodsEl.querySelectorAll(".mood-card").forEach((c) =>
        c.classList.toggle("active", c.dataset.mood === name));
      this.composeBtn.disabled = false;
    },

    _biasDefault(m) {
      if (this.mood) return;  // respect an explicit user choice
      const want = m === "w" ? "happy" : "dark";
      const card = this.moodsEl.querySelector(`.mood-card[data-mood="${want}"]`);
      if (card) card.classList.add("active"), (this.mood = want, this.composeBtn.disabled = false);
    },

    /* ---------- the one button that does everything ---------- */
    // Some moods resolve to scales that have no diatonic triads (e.g. dark →
    // phrygianDominant). composeSong returns null for those, so we keep the
    // mood + key but substitute a closely-related chord-friendly scale so the
    // user ALWAYS gets a playable song. Mirrors Spark's SCALE_FALLBACK idea.
    _SCALE_FALLBACK: {
      phrygianDominant: "phrygian",
      majorPentatonic:  "major",
      minorPentatonic:  "minor",
      blues:            "minor",
      melodicMinor:     "harmonicMinor",
      locrian:          "phrygian",
    },

    _composeResilient(opts) {
      let song = null;
      try { song = MoodEngine.composeSong(opts); } catch (e) { song = null; }
      if (song) return song;
      // figure out which scale the mood resolved to, then substitute.
      const recipe = MoodEngine.moodToMusic(opts.mood, opts.key ? { key: opts.key } : undefined);
      const sub = this._SCALE_FALLBACK[recipe.scale] || "minor";
      const opts2 = Object.assign({}, opts, { scale: sub });
      if (!opts2.key) opts2.key = recipe.key; // keep the mood's preferred root
      try { song = MoodEngine.composeSong(opts2); } catch (e) { song = null; }
      return song;
    },

    compose() {
      if (!this.mood || !root.MoodEngine) return;
      const opts = { mood: this.mood };
      if (this.keySel && this.keySel.value)   opts.key   = this.keySel.value;
      if (this.tempoSel && this.tempoSel.value) opts.tempo = +this.tempoSel.value;

      const song = this._composeResilient(opts);
      if (!song) { this.app.toast("Couldn't compose — try another vibe"); return; }
      this.song = song;

      // 1) Set the key app-wide so every board follows.
      this.app.setKey(song.key, song.scale);
      // 2) Sync the riff BPM so a later Play lines up.
      if (root.Riff) { root.Riff.bpm = song.tempo; root.Riff.dirty = true; }

      this.renderSong(song);
      this.playBtn.style.display = "";
      this.app.startAudio();
      this.app.toast(`🎼 ${this.mood} song in ${song.key} ${song.scaleName.split(" ")[0]} · ${song.tempo}bpm`);
    },

    /* ---------- audition helpers (reuse the app's audio path) ---------- */
    _inst() {
      return this.app.state.instrument === "guitar" ? this.app.state.guitarSound : "piano";
    },

    // Voice a chord object's note names (no octave) into playable notes.
    _voiced(ch) {
      if (ch.notes && /\d/.test(ch.notes[0] || "")) return ch.notes; // already voiced
      return root.Theory ? Theory.voiceChord(ch.notes, 3) : ch.notes;
    },

    playOneChord(ch) {
      if (!ch) return;
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const t0 = AudioEngine.now() + 0.02;
        this._voiced(ch).forEach((vn, j) => AudioEngine.play(vn, "2n", 0.78, t0 + j * 0.022, inst));
      });
    },

    // Play the whole composed song: chords (one per beat) with the riff over
    // the top, both from one shared clock at the song tempo.
    play() {
      const s = this.song;
      if (!s) return;
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const beat = 60 / (s.tempo || 100);
        const t0 = AudioEngine.now() + 0.12;
        // chords: 2 beats each
        s.progression.forEach((ch, i) => {
          this._voiced(ch).forEach((vn, j) =>
            AudioEngine.play(vn, "2n", 0.7, t0 + i * beat * 2 + j * 0.022, inst));
        });
        // riff over the top via the Riff engine's scheduler (keeps timing logic in one place)
        if (root.Riff && s.riff && s.riff.length) {
          try { root.Riff._scheduleNotes(s.riff, t0, root.Riff.instrument, null); } catch (e) {}
        }
      });
    },

    /* ---------- load the song into the rest of the app ---------- */
    loadRiffIntoWriter() {
      const s = this.song;
      if (!s || !s.riff || !root.Riff) return;
      try {
        Riff.riff = s.riff.map((n) => ({ ...n }));
        Riff.selected = null; Riff.dirty = true;
        Riff.bpm = s.tempo;
        const bv = document.getElementById("riff-bpm"); if (bv) bv.value = s.tempo;
        const bvl = document.getElementById("riff-bpm-val"); if (bvl) bvl.textContent = s.tempo;
        Riff.render(); Riff.renderEditor();
      } catch (e) {}
      const tab = document.querySelector('[data-tab="riff"]');
      if (tab) tab.click();
      this.app.toast("Riff loaded in the Riff Writer ✓");
    },

    sendProgToStudio() {
      const s = this.song;
      if (!s || !root.Looper) { this.app.toast("Studio not ready"); return; }
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const beat = 60 / (s.tempo || 100);
        const events = [];
        s.progression.forEach((ch, i) => {
          this._voiced(ch).forEach((vn, j) => {
            events.push({ time: i * beat * 2 + j * 0.02, note: vn, dur: beat * 2 * 0.92, instrument: inst });
          });
        });
        Looper.addTrack(
          `🎼 ${this.mood} · ${s.key} ${s.scaleName.split(" ")[0]}`,
          events, s.progression.length * beat * 2);
        this.app.toast("Progression sent to Studio ✓");
        const tab = document.querySelector('[data-tab="studio"]');
        if (tab) tab.click();
      });
    },

    sendRiffToStudio() {
      const s = this.song;
      if (!s || !s.riff || !root.Riff || !root.Looper) return;
      // Reuse the Riff engine's exact looper hand-off by temporarily loading
      // the song riff into it, then calling its sendToLooper.
      const prev = { riff: root.Riff.riff, bpm: root.Riff.bpm };
      try {
        root.Riff.riff = s.riff.map((n) => ({ ...n }));
        root.Riff.bpm = s.tempo;
        root.Riff.sendToLooper();
      } catch (e) {}
      root.Riff.riff = prev.riff; root.Riff.bpm = prev.bpm;
    },

    /* ---------- render the composed song card ---------- */
    renderSong(s) {
      const ui = MOOD_UI[this.mood] || { emoji: "🎵" };
      const chords = s.progression.map((ch, i) =>
        `<button class="cs-chord" data-csc="${i}">${ch.symbol}<small>${ch.roman || ""}</small></button>`).join("");
      const riffPreview = (s.riff || []).filter((n) => !n.rest).slice(0, 10)
        .map((n) => String(n.note).replace(/\d/, "")).join(" ");
      const structure = (s.structure || []).map((sec) =>
        `<span class="cs-sec">${sec.name}</span>`).join("");

      this.resultEl.innerHTML =
        `<div class="composer-song glass">
           <div class="cs-head">
             <span class="cs-mood">${ui.emoji} ${this.mood.replace("-", " ")}</span>
             <span class="cs-key">${s.key} ${s.scaleName}</span>
           </div>
           <p class="cs-meta">Tempo <b>${s.tempo} bpm</b> · Groove <b>${s.meta ? s.meta.groove : ""}</b> · Energy <b>${s.meta ? s.meta.energy : ""}/10</b></p>

           <div class="cs-section">
             <span class="cs-eyebrow">Chord progression — tap to hear</span>
             <div class="cs-chords">${chords}</div>
           </div>

           ${riffPreview ? `<div class="cs-section">
             <span class="cs-eyebrow">Riff</span>
             <div class="cs-riff">${riffPreview} …</div>
           </div>` : ""}

           ${structure ? `<div class="cs-section">
             <span class="cs-eyebrow">Song structure</span>
             <div class="cs-structure">${structure}</div>
           </div>` : ""}

           <div class="cs-actions">
             <button class="btn-accent" data-cs-act="play">▶ Play the song</button>
             <button class="send-btn" data-cs-act="prog-studio">→ Progression to Studio</button>
             <button class="send-btn" data-cs-act="riff-studio">→ Riff to Studio</button>
             <button class="send-btn" data-cs-act="riff-writer">→ Open riff in Riff Writer</button>
           </div>
         </div>`;

      // wire chord auditions
      this.resultEl.querySelectorAll(".cs-chord").forEach((b) =>
        b.addEventListener("click", () => this.playOneChord(s.progression[+b.dataset.csc])));
      // wire actions
      const act = (name) => this.resultEl.querySelector(`[data-cs-act="${name}"]`);
      act("play").addEventListener("click", () => this.play());
      act("prog-studio").addEventListener("click", () => this.sendProgToStudio());
      act("riff-studio").addEventListener("click", () => this.sendRiffToStudio());
      act("riff-writer").addEventListener("click", () => this.loadRiffIntoWriter());
    },
  };

  root.Composer = Composer;
  document.addEventListener("DOMContentLoaded", () => {
    if (root.App) Composer.mount(root.App);
  });
})(typeof window !== "undefined" ? window : globalThis);
