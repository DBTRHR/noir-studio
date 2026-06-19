/* =====================================================================
   NOIR Studio — ✦ SPARK
   One-tap song-idea generator for writing by ear. Each tap picks a mood
   + key (applied app-wide via the REAL App.setKey/setFeeling so every
   board follows), a diatonic chord progression (Theory.diatonicChords),
   and a riff (Riff._makeRiff) — all immediately playable. Keep the
   keepers on a localStorage idea shelf.

   Reuses, never reinvents:
     App.setKey / App.setFeeling   → switch the global key (KEY readout,
                                     piano, guitar, chords, scales follow)
     App.startAudio / App.toast
     Theory.diatonicChords         → real diatonic triads for the key
     AudioEngine.play              → strum/play chords
     Riff._makeRiff / _scheduleNotes / riff / render / renderEditor
     Looper.addTrack(name, events, loopLen)
   ===================================================================== */
(function (root) {
  "use strict";

  const STORE_KEY = "noir.sparks";

  // Scales that yield real diatonic triads (have TRIAD_QUALITIES). These are
  // the "writable" palette — every Spark lands on one of these so the
  // progression is always valid. Feelings on other scales (pentatonic, blues,
  // phrygian-dominant, melodic minor) borrow a closely-related scale here for
  // chord-building while keeping their mood + name.
  const DIATONIC_SCALES = ["major", "minor", "harmonicMinor", "dorian",
                           "phrygian", "lydian", "mixolydian"];
  // mood-preserving fallback for scales without diatonic triads
  const SCALE_FALLBACK = {
    majorPentatonic:  "major",
    minorPentatonic:  "minor",
    blues:            "minor",
    phrygianDominant: "phrygian",
    melodicMinor:     "harmonicMinor",
    locrian:          "phrygian",
  };

  const MINORISH = new Set(["minor", "harmonicMinor", "melodicMinor", "dorian",
    "phrygian", "locrian", "minorPentatonic", "blues", "phrygianDominant"]);

  // Common, ear-friendly songwriting shapes, by scale-degree index (0-based).
  // Picked to be genuinely playable starting points.
  const PROG_SHAPES = {
    major: [
      { name: "I – V – vi – IV", deg: [0, 4, 5, 3] },   // the "four chords"
      { name: "I – IV – V",      deg: [0, 3, 4] },
      { name: "vi – IV – I – V", deg: [5, 3, 0, 4] },
      { name: "I – vi – IV – V", deg: [0, 5, 3, 4] },    // doo-wop
    ],
    minor: [
      { name: "i – VI – VII",     deg: [0, 5, 6] },      // andalusian-ish lift
      { name: "i – iv – v",       deg: [0, 3, 4] },
      { name: "i – VI – III – VII", deg: [0, 5, 2, 6] },
      { name: "i – VII – VI",     deg: [0, 6, 5] },
    ],
  };

  const PROMPTS = [
    "Grab your guitar and find the melody.",
    "Hum over it. Keep the first thing that feels right.",
    "Play the chords. Let your hand wander between them.",
    "Don't think. Just play along and listen.",
    "Find one note that feels like home. Build from there.",
    "Sing nonsense over it. The words come later.",
    "Loop it. Walk away. Come back and finish it.",
    "Play it slow. Then play it like you mean it.",
    "Follow the riff with your voice. Trust your ear.",
    "Make it darker. Or make it brighter. Just commit.",
  ];

  const Spark = {
    app: null,
    current: null,   // { mood, emoji, blurb, root, scale, scaleName, prog, riff, prompt }
    kept: [],

    /* ---------- mount ---------- */
    mount(app) {
      this.app = app;
      this.cardEl  = document.getElementById("spark-card");
      this.keptEl  = document.getElementById("spark-kept-list");
      this.btnSpark = document.getElementById("spark-go");

      this.btnSpark.addEventListener("click", () => {
        this.app.startAudio();   // wake audio on first interaction
        this.roll();
      });

      this._loadKept();
      this.renderKept();
      this.renderEmpty();
    },

    /* ---------- idea generation ---------- */
    _pick(arr) { return arr[Math.floor(this.app.rand() * arr.length)]; },

    // choose a mood + key, biased toward writable diatonic scales
    _pickMood() {
      // prefer feelings whose scale (or fallback) gives diatonic chords
      const feelings = NoirData.FEELINGS.slice();
      const f = this._pick(feelings);
      const chordScale = DIATONIC_SCALES.includes(f.scale)
        ? f.scale
        : (SCALE_FALLBACK[f.scale] || "minor");
      return {
        mood: f.label,
        emoji: f.emoji,
        blurb: f.blurb,
        root: f.root,
        scale: chordScale,                  // what we apply app-wide + build on
        displayScale: f.scale,              // the mood's native scale name
      };
    },

    _scaleShort(scale) {
      const def = Theory.SCALES[scale];
      return def ? def.name.split(" ")[0] : scale;
    },

    // build a diatonic progression for the chosen key
    _makeProg(rootName, scale) {
      const chords = Theory.diatonicChords(rootName, scale);
      if (!chords || !chords.length) return null;
      const minorish = MINORISH.has(scale);
      const shape = this._pick(minorish ? PROG_SHAPES.minor : PROG_SHAPES.major);
      const seq = shape.deg.map((i) => chords[i % chords.length]).filter(Boolean);
      return { name: shape.name, chords: seq };
    },

    roll() {
      const m = this._pickMood();
      // Apply the key app-wide via the REAL setter so KEY readout + every
      // board (piano/guitar/chords/scales/keyboard-play) follows.
      this.app.setKey(m.root, m.scale);

      const prog = this._makeProg(m.root, m.scale);

      // Real riff from the Riff engine, in the now-active key.
      let riff = [];
      try { riff = (Riff._makeRiff(8, "cookie")) || []; } catch (e) { riff = []; }

      this.current = {
        mood: m.mood, emoji: m.emoji, blurb: m.blurb,
        root: m.root, scale: m.scale,
        scaleName: Theory.SCALES[m.scale] ? Theory.SCALES[m.scale].name : m.scale,
        prog, riff,
        prompt: this._pick(PROMPTS),
        ts: Date.now(),
      };
      this.renderCard();
      this.app.toast(`✦ ${m.emoji} ${m.mood} — ${m.root} ${this._scaleShort(m.scale)}`);
    },

    /* ---------- chord voicing + playback (mirrors the app's approach) ---------- */
    _voiceChord(notes) {
      let oct = 3, prevPc = -1;
      return notes.map((n) => {
        const pc = Theory.noteIndex(n);
        if (prevPc >= 0 && pc <= prevPc) oct++;
        prevPc = pc;
        return n + oct;
      });
    },
    _inst() {
      return this.app.state.instrument === "guitar" ? this.app.state.guitarSound : "piano";
    },

    playProg(seq) {
      if (!seq || !seq.length) return;
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const t0 = AudioEngine.now() + 0.06;
        const beat = 0.95;
        seq.forEach((ch, i) => {
          this._voiceChord(ch.notes).forEach((vn, j) =>
            AudioEngine.play(vn, "2n", 0.75, t0 + i * beat + j * 0.022, inst));
        });
      });
    },

    // Tempo to lock chords + riff together. Use the Riff engine's current BPM
    // (default 100) so both feel align rhythmically. One beat = 60/bpm seconds.
    _syncBeat() {
      const bpm = (root.Riff && root.Riff.bpm) ? root.Riff.bpm : 100;
      return 60 / bpm;
    },

    // Schedule chord strums against an externally supplied shared start time.
    // `beat` is seconds-per-chord. Returns the chord block's total length (s).
    _scheduleProg(seq, t0, beat, inst) {
      if (!seq || !seq.length) return 0;
      seq.forEach((ch, i) => {
        this._voiceChord(ch.notes).forEach((vn, j) =>
          AudioEngine.play(vn, "2n", 0.72, t0 + i * beat + j * 0.022, inst));
      });
      return seq.length * beat;
    },

    // PLAY BOTH — chords + riff from the SAME clock so they never drift.
    // We compute ONE t0 = AudioEngine.now() + lead-in and schedule the chord
    // strums (via _scheduleProg) AND the riff notes (via Riff._scheduleNotes,
    // which already accepts a start-time arg) against that same t0. Both use
    // the riff's BPM for the beat, so they stay rhythmically aligned.
    playBoth(seq, riffSeq) {
      const hasProg = seq && seq.length;
      const hasRiff = riffSeq && riffSeq.length && root.Riff;
      if (!hasProg && !hasRiff) return;
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const t0 = AudioEngine.now() + 0.12; // single shared lead-in
        const beat = this._syncBeat();       // chord beat from riff BPM
        if (hasProg) this._scheduleProg(seq, t0, beat, inst);
        if (hasRiff) {
          try { root.Riff._scheduleNotes(riffSeq, t0, root.Riff.instrument, null); }
          catch (e) {}
        }
      });
    },

    // play a single chord (click-to-hear on a chord chip)
    playOneChord(ch) {
      if (!ch || !ch.notes) return;
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const t0 = AudioEngine.now() + 0.02;
        this._voiceChord(ch.notes).forEach((vn, j) =>
          AudioEngine.play(vn, "2n", 0.78, t0 + j * 0.022, inst));
      });
    },

    // Drag-to-reorder the progression. The order lives in
    // this.current.prog.chords (the same array all playback reads), so once we
    // splice it the next Play chords / Play both / Send to Looper uses the new
    // order. We distinguish a click (hear the chord) from a drag (reorder) via
    // a per-pointer "moved" flag set on dragstart.
    _wireChords() {
      const wrap = this.cardEl.querySelector("[data-spark-chords]");
      if (!wrap) return;
      const chips = Array.from(wrap.querySelectorAll(".spark-chord"));
      let dragFrom = null;     // index being dragged
      let didDrag = false;     // true if a drag actually started

      chips.forEach((chip) => {
        const idx = () => parseInt(chip.dataset.ci, 10);

        chip.addEventListener("click", () => {
          if (didDrag) { didDrag = false; return; } // swallow click after a drag
          const s = this.current;
          if (s && s.prog && s.prog.chords) this.playOneChord(s.prog.chords[idx()]);
        });

        chip.addEventListener("dragstart", (e) => {
          dragFrom = idx();
          didDrag = true;
          chip.classList.add("dragging");
          try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (err) {}
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("dragging");
          chips.forEach((c) => c.classList.remove("drag-over"));
          // reset shortly after so the synthetic click that follows is swallowed
          setTimeout(() => { didDrag = false; }, 0);
        });
        chip.addEventListener("dragover", (e) => {
          e.preventDefault();
          try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
          if (idx() !== dragFrom) chip.classList.add("drag-over");
        });
        chip.addEventListener("dragleave", () => chip.classList.remove("drag-over"));
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          chip.classList.remove("drag-over");
          const to = idx();
          if (dragFrom == null || to === dragFrom) return;
          this._reorderChord(dragFrom, to);
        });
      });
    },

    _reorderChord(from, to) {
      const s = this.current;
      if (!s || !s.prog || !s.prog.chords) return;
      const arr = s.prog.chords;
      if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      this.renderCard(); // re-render reflects new order + re-wires handlers
    },

    progToLooper(seq, idea) {
      if (!seq || !seq.length || !root.Looper) { this.app.toast("Looper not ready"); return; }
      this.app.startAudio().then(() => {
        const inst = this._inst();
        const beat = 1.0; // ~60bpm, one chord per bar feel
        const events = [];
        seq.forEach((ch, i) => {
          this._voiceChord(ch.notes).forEach((vn, j) => {
            events.push({ time: i * beat + j * 0.02, note: vn, dur: beat * 0.92, instrument: inst });
          });
        });
        Looper.addTrack(
          `✦ ${idea.root} ${this._scaleShort(idea.scale)} · ${seq.map((x) => x.roman).join("-")}`,
          events, seq.length * beat);
        this.app.toast("Progression sent to Looper ✓");
      });
    },

    playRiff(seq) {
      if (!seq || !seq.length || !root.Riff) return;
      this.app.startAudio().then(() => {
        try { Riff._scheduleNotes(seq, AudioEngine.now() + 0.08, Riff.instrument, null); } catch (e) {}
      });
    },

    openRiff(seq) {
      if (!seq || !seq.length || !root.Riff) return;
      try {
        Riff.riff = seq.map((s) => ({ ...s }));
        Riff.selected = null;
        Riff.dirty = true; // suppress auto-regen on key change
        Riff.render(); Riff.renderEditor();
      } catch (e) {}
      const tabBtn = document.querySelector('[data-tab="riff"]');
      if (tabBtn) tabBtn.click();
      this.app.toast("Riff loaded in the Riff Writer ✓");
    },

    /* ---------- render: the one idea on screen ---------- */
    renderEmpty() {
      this.cardEl.innerHTML =
        `<div class="spark-empty">
           <div class="spark-empty-mark">✦</div>
           <p class="spark-empty-lead">Stuck? Tap the button.</p>
           <p class="spark-empty-sub">You'll get a key, a few chords, and a riff —
             tuned across the whole app so you can just play along by ear.</p>
         </div>`;
    },

    renderCard() {
      const s = this.current;
      if (!s) { this.renderEmpty(); return; }
      const keyLine = `${s.root} ${this._scaleShort(s.scale)}`;
      const moodLine = `${s.emoji} ${s.mood}`;

      const progBlock = s.prog && s.prog.chords.length
        ? `<div class="spark-section">
             <span class="spark-eyebrow">Chords · ${s.prog.name}</span>
             <div class="spark-chords" data-spark-chords>
               ${s.prog.chords.map((ch, i) =>
                 `<span class="spark-chord" draggable="true" data-ci="${i}" title="Drag to reorder · click to hear">${ch.symbol}<small>${ch.roman}</small></span>`).join("")}
             </div>
             <div class="spark-actions-row">
               <button class="btn-accent" data-act="prog-play">▶ Play chords</button>
               ${s.riff && s.riff.length ? `<button class="btn-accent" data-act="play-both">▶▶ Play both</button>` : ""}
               <button class="btn" data-act="prog-loop">⟲ Send to Looper</button>
             </div>
           </div>`
        : `<div class="spark-section"><p class="muted">This mood is melodic — skip the chords and chase the riff.</p></div>`;

      const riffPreview = s.riff.filter((x) => !x.rest).slice(0, 8)
        .map((x) => x.note.replace(/\d/, "")).join(" ");
      const riffBlock = s.riff.length
        ? `<div class="spark-section">
             <span class="spark-eyebrow">Riff</span>
             <div class="spark-riff-preview">${riffPreview} …</div>
             <div class="spark-actions-row">
               <button class="btn-accent" data-act="riff-play">▶ Play riff</button>
               <button class="btn" data-act="riff-open">Open in Riff Writer</button>
             </div>
           </div>`
        : "";

      this.cardEl.innerHTML =
        `<div class="spark-idea glass">
           <div class="spark-mood">
             <span class="spark-mood-emoji">${s.emoji}</span>
             <div class="spark-mood-text">
               <span class="spark-key">${keyLine}</span>
               <span class="spark-mood-name">${moodLine}</span>
             </div>
           </div>
           <p class="spark-prompt">${s.prompt}</p>
           ${progBlock}
           ${riffBlock}
           <div class="spark-keep-row">
             <button class="btn" data-act="keep">★ Keep it</button>
           </div>
         </div>`;

      const c = this.cardEl;
      const q = (a) => c.querySelector(`[data-act="${a}"]`);
      const progPlay = q("prog-play"); if (progPlay) progPlay.addEventListener("click", () => this.playProg(s.prog.chords));
      const playBoth = q("play-both"); if (playBoth) playBoth.addEventListener("click", () => this.playBoth(s.prog.chords, s.riff));
      const progLoop = q("prog-loop"); if (progLoop) progLoop.addEventListener("click", () => this.progToLooper(s.prog.chords, s));
      const riffPlay = q("riff-play"); if (riffPlay) riffPlay.addEventListener("click", () => this.playRiff(s.riff));
      const riffOpen = q("riff-open"); if (riffOpen) riffOpen.addEventListener("click", () => this.openRiff(s.riff));
      q("keep").addEventListener("click", () => this.keepCurrent());

      // Wire chord interactions: click-to-hear + drag-to-reorder.
      this._wireChords();

      // re-roll button label nudges from "Spark me" to "Spark again"
      const goLabel = this.btnSpark && this.btnSpark.querySelector(".spark-go-label");
      if (goLabel) goLabel.textContent = "✦ Spark again";
    },

    /* ---------- keep shelf (localStorage) ---------- */
    _loadKept() {
      try { this.kept = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
      catch (e) { this.kept = []; }
    },
    _persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.kept)); } catch (e) {} },

    keepCurrent() {
      const s = this.current;
      if (!s) return;
      const d = new Date(s.ts || Date.now());
      const date = `${d.getMonth() + 1}/${d.getDate()}`;
      const name = `${s.emoji} ${s.mood} · ${s.root} ${this._scaleShort(s.scale)} · ${date}`;
      // de-dupe identical recent saves
      this.kept.unshift({
        name, mood: s.mood, emoji: s.emoji, blurb: s.blurb,
        root: s.root, scale: s.scale,
        prog: s.prog, riff: s.riff, prompt: s.prompt, ts: s.ts || Date.now(),
      });
      this.kept = this.kept.slice(0, 40);
      this._persist();
      this.renderKept();
      this.app.toast(`Kept “${s.emoji} ${s.mood}” ✓`);
    },

    loadKept(i) {
      const item = this.kept[i];
      if (!item) return;
      // re-apply the key app-wide
      this.app.setKey(item.root, item.scale);
      this.current = {
        mood: item.mood, emoji: item.emoji, blurb: item.blurb,
        root: item.root, scale: item.scale,
        scaleName: Theory.SCALES[item.scale] ? Theory.SCALES[item.scale].name : item.scale,
        prog: item.prog, riff: item.riff || [],
        prompt: item.prompt || this._pick(PROMPTS),
        ts: item.ts,
      };
      this.renderCard();
      this.app.toast(`Loaded “${item.emoji} ${item.mood}”`);
    },

    deleteKept(i) {
      this.kept.splice(i, 1);
      this._persist();
      this.renderKept();
    },

    renderKept() {
      const c = this.keptEl;
      c.innerHTML = "";
      if (!this.kept.length) {
        c.innerHTML = `<p class="muted">No kept ideas yet. When a Spark feels right, hit <b>★ Keep it</b> — it lands here so nothing gets lost.</p>`;
        return;
      }
      this.kept.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "spark-kept-row glass";
        row.innerHTML =
          `<button class="spark-kept-load" title="Load this idea">
             <span class="spark-kept-name">${item.name}</span>
             <span class="spark-kept-sub">${item.prog ? item.prog.name : "melodic idea"}</span>
           </button>
           <button class="spark-kept-del" title="Delete">✕</button>`;
        row.querySelector(".spark-kept-load").addEventListener("click", () => this.loadKept(i));
        row.querySelector(".spark-kept-del").addEventListener("click", (e) => {
          e.stopPropagation(); this.deleteKept(i);
        });
        c.appendChild(row);
      });
    },
  };

  root.Spark = Spark;

  // Mount after App.init has run (App.init mounts the other modules in its
  // own DOMContentLoaded handler; we listen separately and guard on App).
  document.addEventListener("DOMContentLoaded", () => {
    if (root.App) Spark.mount(root.App);
  });
})(typeof window !== "undefined" ? window : globalThis);
