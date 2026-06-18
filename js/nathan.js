/* =====================================================================
   NOIR Studio — Nathan Explosion, in-app metal mentor
   - Offline first: answers from window.NoirKB (119 researched cards) via
     weighted keyword/synonym retrieval, wrapped in Nathan's deadpan voice.
   - Actionable: when you ask for a progression or riff, he GENERATES one
     with the app's real engines (Theory.diatonicChords / Riff) and gives
     you ▶ Play and "send to Looper / open in Riff Writer" buttons.
   - Context aware: references the live key/scale and current tab.
   - Optional: connect an OpenAI key (stored locally) for free-form chat,
     grounded with the same knowledge. Falls back to offline if it fails.
   - Headbangs (avatar + header) on a timer and when he talks; drops tips.
   ===================================================================== */
(function (root) {
  "use strict";

  const KEY_STORE = "noir.openaiKey";

  const OPENERS = [
    "Okay, so, like…", "Alright.", "Heh.", "Listen up.", "So, you know…",
    "Brutal question.", "Mmm.", "Yeah, okay.",
  ];
  const CLOSERS = [
    "…that's pretty metal.", "…you know. Brutal.", "…don't screw it up.",
    "…now go make something dark.", "…that's just, like, how it works.",
    "…metal.", "…trust me, I'm a professional.",
  ];
  const TIPS = [
    "A riff is just a good idea you're not afraid to repeat. Repeat it. Then make it heavier.",
    "Land your strong notes on the downbeat and on chord tones. The ear wants to come home. Brutal home.",
    "Minor pentatonic over everything. It's like the food court of scales. Nothing's wrong there.",
    "Tension then release. Build it up, make 'em wait, then drop the hammer. That's the whole trick.",
    "If your guitar buzzes on open strings, your nut slots are too low. If it buzzes up the neck, check your truss rod relief.",
    "Phrygian. Flat second. Instant evil. Use it.",
    "Don't quantize the soul out of it. A little human timing is what makes a groove feel alive.",
    "Stepwise motion sings. Big leaps are for when you mean it. Then step back down.",
    "Write the hook first. If you can't hum it after one listen, it's not a hook, it's homework.",
    "Drop tuning doesn't make a bad riff good. It makes a good riff lower. Which is still good.",
  ];

  // Synonym / stemming map: query word -> extra tokens it should also match.
  // Lets shallow keyword cards get hit by natural phrasing.
  const SYNONYMS = {
    progression: ["chord", "chords", "changes", "sequence"],
    progressions: ["chord", "chords", "changes", "sequence"],
    chord: ["chords", "progression", "triad", "harmony"],
    chords: ["chord", "progression", "triad", "harmony"],
    riff: ["lick", "motif", "phrase", "melody"],
    lick: ["riff", "phrase", "melody"],
    solo: ["lead", "improv", "scale", "pentatonic"],
    buzz: ["buzzing", "fret", "rattle", "setup", "action", "relief"],
    buzzing: ["buzz", "fret", "rattle", "setup", "action"],
    tune: ["tuning", "intonation", "pitch"],
    tuning: ["tune", "intonation"],
    sad: ["minor", "dark", "emotion"],
    happy: ["major", "bright", "emotion"],
    dark: ["minor", "evil", "phrygian", "emotion"],
    evil: ["phrygian", "dark", "diminished", "tritone"],
    catchy: ["hook", "earworm", "memorable", "repetition"],
    hook: ["catchy", "earworm", "memorable"],
    why: ["because", "reason"],
    next: ["progression", "resolution", "cadence", "follow"],
    scale: ["mode", "scales"],
    scales: ["scale", "mode"],
    fix: ["setup", "repair", "adjust"],
    sound: ["tone", "timbre", "sounds"],
    sounds: ["sound", "tone"],
  };
  const STOP = new Set(["the","a","an","is","are","my","i","me","you","to","of","in","on",
    "for","and","or","do","does","how","what","why","it","that","this","with","can","get","make"]);

  const Nathan = {
    open: false,
    greeted: false,
    busy: false,
    history: [],
    _bangTimer: null,
    _tipTimer: null,

    mount() {
      this.root   = document.getElementById("nathan");
      this.avatar = document.getElementById("nathan-avatar");
      this.chat   = document.getElementById("nathan-chat");
      this.log    = document.getElementById("nathan-log");
      this.input  = document.getElementById("nathan-q");
      this.bubble = document.getElementById("nathan-bubble");
      this.typing = document.getElementById("nathan-typing");
      this.chips  = document.getElementById("nathan-chips");
      this.keyTag = document.getElementById("nathan-keytag");
      this.headAvatar = document.getElementById("nch-head-banger") &&
        document.getElementById("nch-head-banger").closest(".nch-avatar");
      if (!this.root) return;

      this.avatar.addEventListener("click", () => this.toggle());
      document.getElementById("nathan-close").addEventListener("click", () => this.toggle(false));
      document.getElementById("nathan-send").addEventListener("click", () => this.ask());
      document.getElementById("nathan-settings").addEventListener("click", () => this.connectKey());
      this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.ask(); });

      // keep the header key-tag + quick chips fresh as the key changes
      this._refreshContext();
      if (root.App && App.on) App.on("change", () => this._refreshContext());

      // idle headbang every so often
      this._scheduleBang();
      // unsolicited tips every ~50s when the chat is closed
      this._tipTimer = setInterval(() => { if (!this.open) this.showBubble(this._randTip()); }, 50000);
      setTimeout(() => { if (!this.open) this.showBubble("Psst. Click me for theory, songwriting, or to fix your buzzing guitar."); }, 4000);
    },

    /* ---------- live context (key / scale / tab) ---------- */
    _ctx() {
      if (!root.App || !App.state) return null;
      const r = App.state.root, s = App.state.scale;
      const scaleName = (Theory.SCALES[s] || {}).name || s;
      const tab = (document.querySelector("[data-tab].active") || {}).dataset;
      return {
        root: r, scale: s, scaleName,
        keyLabel: `${r} ${scaleName}`,
        shortKey: `${r} ${scaleName.split(" ")[0]}`,
        isMinorish: ["minor","harmonicMinor","melodicMinor","dorian","phrygian","locrian","minorPentatonic","blues","phrygianDominant"].includes(s),
        tab: tab ? tab.tab : null,
      };
    },
    _refreshContext() {
      const c = this._ctx();
      if (this.keyTag) this.keyTag.textContent = c ? `🎚 ${c.keyLabel}` : "";
      if (this.open) this._renderChips();
    },

    /* ---------- quick-action chips ---------- */
    _renderChips() {
      if (!this.chips) return;
      const c = this._ctx();
      const k = c ? c.shortKey : "your key";
      const items = [
        { label: `🎸 Progression in ${k}`, q: "give me a chord progression in this key" },
        { label: "🔮 Riff idea", q: "give me a riff idea" },
        { label: "🎚 What chord comes next?", q: "what chord comes next" },
        { label: "❓ Why does my key sound like that?", q: c && c.isMinorish ? "why does minor sound sad" : "why does major sound happy" },
        { label: "🔧 Fix fret buzz", q: "how do I fix fret buzz" },
        { label: "✍️ Write a catchy hook", q: "how do I write a catchy hook" },
      ];
      this.chips.innerHTML = "";
      items.forEach((it) => {
        const b = document.createElement("button");
        b.className = "n-quick";
        b.type = "button";
        b.textContent = it.label;
        b.addEventListener("click", () => { this.input.value = it.q; this.ask(); });
        this.chips.appendChild(b);
      });
    },

    /* ---------- headbang + bubble ---------- */
    _scheduleBang() {
      const next = 6000 + Math.random() * 9000;
      this._bangTimer = setTimeout(() => { this.headbang(); this._scheduleBang(); }, next);
    },
    headbang(times = 4) {
      this._bangEl(this.avatar, times);
      if (this.headAvatar) this._bangEl(this.headAvatar, times);
    },
    _bangEl(el, times) {
      if (!el) return;
      el.classList.remove("banging");
      void el.offsetWidth; // restart animation
      el.style.setProperty("--bangs", times);
      el.classList.add("banging");
      setTimeout(() => el.classList.remove("banging"), times * 240 + 60);
    },
    showBubble(text, ms = 6000) {
      if (!this.bubble) return;
      this.bubble.textContent = text;
      this.bubble.classList.add("show");
      this.headbang(2);
      clearTimeout(this._bubbleTimer);
      this._bubbleTimer = setTimeout(() => this.bubble.classList.remove("show"), ms);
    },
    _randTip() {
      const dyn = [];
      const c = this._ctx();
      if (c) dyn.push(`You're in ${c.keyLabel}. The notes are right there on the board. Stop hunting and start writing.`);
      const pool = TIPS.concat(dyn);
      return pool[Math.floor(Math.random() * pool.length)];
    },

    /* ---------- chat open/close ---------- */
    toggle(force) {
      this.open = force == null ? !this.open : force;
      this.root.classList.toggle("chat-open", this.open);
      if (this.open) {
        this.bubble.classList.remove("show");
        this._renderChips();
        if (!this.greeted) { this.greet(); this.greeted = true; }
        setTimeout(() => this.input.focus(), 50);
      }
    },
    greet() {
      const hasKey = !!localStorage.getItem(KEY_STORE);
      const c = this._ctx();
      this.addMsg("nathan",
        "Nathan Explosion. I write brutal music and I know how it works. " +
        (c ? `You're in ${c.keyLabel} right now. ` : "") +
        "Ask me about scales, chords, songwriting, what sounds good and why, or how to fix your gear — " +
        "or hit a button below and I'll build you something. " +
        (hasKey ? "OpenAI's hooked up, so I can riff freely." : "I run fine offline. Hit ⚙ to plug in OpenAI for deeper talks."));
      this.headbang(3);
    },

    addMsg(who, text) {
      const row = document.createElement("div");
      row.className = "n-msg " + who;
      row.innerHTML = `<span class="n-who">${who === "nathan" ? "🤘 NATHAN" : "YOU"}</span><span class="n-text"></span>`;
      row.querySelector(".n-text").textContent = text;
      this.log.appendChild(row);
      this.log.scrollTop = this.log.scrollHeight;
      return row;
    },

    /* ---------- typing indicator ---------- */
    _setTyping(on) {
      if (!this.typing) return;
      this.typing.classList.toggle("show", !!on);
      if (on) this.log.scrollTop = this.log.scrollHeight;
    },

    /* ---------- ask ---------- */
    async ask() {
      const q = this.input.value.trim();
      if (!q || this.busy) return;
      this.input.value = "";
      this.addMsg("you", q);
      this.history.push({ role: "user", content: q });
      this.headbang(2);
      this.busy = true;
      this._setTyping(true);

      // Actionable intents are handled locally with the app's real engines,
      // regardless of OpenAI — they need to render buttons, not prose.
      const action = this._detectAction(q);
      try {
        if (action) {
          // brief voiced lead-in, then the interactive block
          const lead = this._voice(action.lead);
          this._setTyping(false);
          const row = this.addMsg("nathan", lead);
          action.render(row);
          this.history.push({ role: "assistant", content: lead + " " + action.summary });
        } else {
          const key = localStorage.getItem(KEY_STORE);
          let answer;
          if (key) answer = await this._askOpenAI(q, key).catch(() => null);
          if (!answer) answer = this._askOffline(q);
          this._setTyping(false);
          this.addMsg("nathan", answer);
          this.history.push({ role: "assistant", content: answer });
        }
        if (this.history.length > 12) this.history = this.history.slice(-12);
      } catch (e) {
        this._setTyping(false);
        this.addMsg("nathan", this._voice(this._askOffline(q)));
      }
      this.busy = false;
      this.log.scrollTop = this.log.scrollHeight;
      this.headbang(3);
    },

    /* =====================================================================
       ACTIONABLE ANSWERS — wired to the real Theory / Riff / Looper engines
       ===================================================================== */
    _detectAction(q) {
      const t = q.toLowerCase();
      const wantsProg = /\b(progression|chord(s)?|changes)\b/.test(t) && !/why|what is|explain/.test(t);
      const wantsNext = /\b(next chord|chord (comes|come) next|what.*next|where.*go)\b/.test(t);
      const wantsRiff = /\b(riff|lick|melody idea|motif)\b/.test(t);
      if (wantsNext) return this._actionNextChord();
      if (wantsProg) return this._actionProgression();
      if (wantsRiff) return this._actionRiff();
      return null;
    },

    _diatonic() {
      const c = this._ctx();
      if (!c) return null;
      const chords = Theory.diatonicChords(c.root, c.scale);
      return chords && chords.length ? { c, chords } : null;
    },

    // Build an actionable chord progression from the live key
    _actionProgression() {
      const d = this._diatonic();
      if (!d) {
        return { lead: "That scale doesn't give me clean diatonic triads — switch to a major or minor key and ask again.",
                 summary: "", render() {} };
      }
      const { c, chords } = d;
      // Pick a tasteful degree pattern that fits major vs minor feel.
      const pattern = c.isMinorish ? [0, 5, 2, 6] : [0, 4, 5, 3]; // i-VI-III-VII / I-V-vi-IV
      const seq = pattern.map((i) => chords[i]).filter(Boolean);
      const romanLine = seq.map((x) => x.roman).join(" – ");
      const self = this;
      return {
        lead: `Here's a progression that works in ${c.keyLabel}: ${romanLine}. Strong, familiar, leaves home and comes back.`,
        summary: `Progression ${romanLine} in ${c.keyLabel}.`,
        render(row) { self._renderProgBlock(row, seq, c); },
      };
    },

    // "What chord comes next" — suggest resolutions from the tonic-ish context
    _actionNextChord() {
      const d = this._diatonic();
      if (!d) return { lead: "Pick a major or minor key and I'll tell you where it wants to go.", summary: "", render() {} };
      const { c, chords } = d;
      // Strongest pulls home: V (dominant) and IV (subdominant); offer both + vi for a deceptive turn.
      const picks = [chords[4], chords[3], chords[5]].filter(Boolean);
      const self = this;
      return {
        lead: `In ${c.keyLabel}, the strongest pull back home is the ${chords[4].roman} (${chords[4].symbol}) — that's your dominant. ` +
              `${chords[3].roman} eases you there, and ${chords[5].roman} is the sneaky deceptive turn. Try these:`,
        summary: `Next-chord options in ${c.keyLabel}: ${picks.map((p) => p.symbol).join(", ")}.`,
        render(row) { self._renderProgBlock(row, picks, c, "Try these next"); },
      };
    },

    _renderProgBlock(row, seq, c, title) {
      const box = document.createElement("div");
      box.className = "n-action";
      const chips = seq.map((ch) =>
        `<span class="n-chip-chord">${ch.symbol}<small>${ch.roman}</small></span>`).join("");
      box.innerHTML =
        `<div class="n-action-title">${title || (c.shortKey + " progression")}</div>
         <div class="n-action-chords">${chips}</div>
         <div class="n-action-btns">
           <button class="n-act-btn primary" data-act="play">▶ Play it</button>
           <button class="n-act-btn" data-act="loop">⟲ Send to Looper</button>
         </div>`;
      row.appendChild(box);
      const self = this;
      box.querySelector('[data-act="play"]').addEventListener("click", function () {
        self._playProgression(seq);
      });
      box.querySelector('[data-act="loop"]').addEventListener("click", function () {
        self._progToLooper(seq, c);
      });
      this.log.scrollTop = this.log.scrollHeight;
    },

    // Voice a triad with octaves for playback (root in oct 3, stack up)
    _voiceChord(notes) {
      let oct = 3, prevPc = -1;
      return notes.map((n) => {
        const pc = Theory.noteIndex(n);
        if (prevPc >= 0 && pc <= prevPc) oct++;
        prevPc = pc;
        return n + oct;
      });
    },
    _playProgression(seq) {
      if (!root.App) return;
      App.startAudio().then(() => {
        const inst = App.state.instrument === "guitar" ? App.state.guitarSound : "piano";
        const t0 = AudioEngine.now() + 0.06;
        seq.forEach((ch, i) => {
          const voiced = this._voiceChord(ch.notes);
          voiced.forEach((vn, j) => AudioEngine.play(vn, "2n", 0.75, t0 + i * 0.95 + j * 0.022, inst));
        });
        this.headbang(seq.length);
      });
    },
    _progToLooper(seq, c) {
      if (!root.Looper || !root.App) { App && App.toast && App.toast("Looper not ready"); return; }
      App.startAudio().then(() => {
        const inst = App.state.instrument === "guitar" ? App.state.guitarSound : "piano";
        const beat = 1.0; // seconds per chord (~60bpm, one bar feel)
        const events = [];
        seq.forEach((ch, i) => {
          this._voiceChord(ch.notes).forEach((vn, j) => {
            events.push({ time: i * beat + j * 0.02, note: vn, dur: beat * 0.92, instrument: inst });
          });
        });
        Looper.addTrack(`Nathan · ${c.shortKey} ${seq.map((x) => x.roman).join("-")}`, events, seq.length * beat);
        App.toast("Progression sent to Looper ✓");
        this.addMsg("nathan", this._voice("Dropped that progression in the Looper. Build a song on it."));
      });
    },

    // Riff idea — generate with the real Riff engine, in the live key
    _actionRiff() {
      if (!root.Riff || !root.App) {
        return { lead: "Riff Writer isn't loaded yet — open the 🔮 Riff Writer tab and hit Generate.", summary: "", render() {} };
      }
      const c = this._ctx();
      // Use the Riff engine's own generator so it's a real, in-key, playable riff.
      let seq = [];
      try { seq = (Riff._makeRiff(Riff.length || 12, "cookie")) || []; } catch (e) { seq = []; }
      const preview = seq.filter((x) => !x.rest).slice(0, 8).map((x) => x.note.replace(/\d/, "")).join(" ");
      const self = this;
      return {
        lead: `Cooked you a riff in ${c ? c.keyLabel : "your key"}: ${preview}… chord tones on the strong beats, resolves home. Make it heavier.`,
        summary: `Riff in ${c ? c.shortKey : "key"}: ${preview}.`,
        render(row) { self._renderRiffBlock(row, seq, preview); },
      };
    },
    _renderRiffBlock(row, seq, preview) {
      const box = document.createElement("div");
      box.className = "n-action";
      box.innerHTML =
        `<div class="n-action-title">Riff idea</div>
         <div class="n-action-chords"><span class="n-chip-chord" style="font-size:12px">${preview} …</span></div>
         <div class="n-action-btns">
           <button class="n-act-btn primary" data-act="play">▶ Play riff</button>
           <button class="n-act-btn" data-act="open">🔮 Open in Riff Writer</button>
         </div>`;
      row.appendChild(box);
      const self = this;
      box.querySelector('[data-act="play"]').addEventListener("click", function () { self._playRiff(seq); });
      box.querySelector('[data-act="open"]').addEventListener("click", function () { self._openRiff(seq); });
      this.log.scrollTop = this.log.scrollHeight;
    },
    _playRiff(seq) {
      if (!root.Riff || !root.App) return;
      App.startAudio().then(() => {
        try { Riff._scheduleNotes(seq, AudioEngine.now() + 0.08, Riff.instrument, null); } catch (e) {}
        this.headbang(4);
      });
    },
    _openRiff(seq) {
      if (!root.Riff || !root.App) return;
      // Load the riff into the real Riff Writer and switch to its tab.
      try {
        Riff.riff = seq.map((s) => ({ ...s }));
        Riff.selected = null;
        Riff.dirty = true; // suppress auto-regen on key change
        Riff.render(); Riff.renderEditor();
      } catch (e) {}
      const tabBtn = document.querySelector('[data-tab="riff"]');
      if (tabBtn) tabBtn.click();
      App.toast("Riff loaded in the Riff Writer ✓");
    },

    /* ---------- offline retrieval (weighted + synonyms/stemming) ---------- */
    _kb() { return root.NoirKB || []; },

    _stem(t) {
      // very light stemming so "chords"->"chord", "buzzing"->"buzz", etc.
      return t.replace(/(ing|ed|es|s)$/,"").replace(/^$/, t);
    },
    _expand(tokens) {
      const out = new Set();
      tokens.forEach((t) => {
        out.add(t);
        const st = this._stem(t);
        if (st && st.length > 1) out.add(st);
        (SYNONYMS[t] || SYNONYMS[st] || []).forEach((syn) => out.add(syn));
      });
      return out;
    },
    _tokenize(q) {
      const raw = q.toLowerCase();
      const base = raw.split(/[\s,.;:!?]+/)
        .map((t) => t.replace(/[^a-z0-9#/-]/g, ""))
        .filter((t) => t && !STOP.has(t));
      return { raw, tokens: this._expand(new Set(base)) };
    },
    _score(entry, tokens, raw) {
      let s = 0;
      (entry.keywords || []).forEach((kw0) => {
        const kw = String(kw0).toLowerCase();          // KBs mix case (e.g. "ii V I")
        if (kw.length > 1 && raw.includes(kw)) s += 6;  // full keyword phrase match: strongest
        kw.split(/[\s/\-]+/).filter(Boolean).forEach((t) => {
          if (tokens.has(t)) s += 2;
          else if (tokens.has(this._stem(t))) s += 1.2;
        });
      });
      const titleToks = (entry.title || "").toLowerCase().split(/\W+/).filter(Boolean);
      titleToks.forEach((t) => { if (tokens.has(t)) s += 2.2; else if (tokens.has(this._stem(t))) s += 1.3; });
      // small nudge: content word overlap as a tiebreaker
      const ctoks = (entry.content || "").toLowerCase().split(/\W+/);
      let c = 0; ctoks.forEach((t) => { if (t.length > 3 && tokens.has(t)) c++; });
      s += Math.min(c, 4) * 0.4;
      return s;
    },
    _bestEntries(q, n = 2) {
      const { raw, tokens } = this._tokenize(q);
      return this._kb()
        .map((e) => ({ e, s: this._score(e, tokens, raw) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, n)
        .map((x) => x.e);
    },
    _askOffline(q) {
      const hits = this._bestEntries(q, 2);
      const c = this._ctx();
      if (!hits.length) {
        const keyLine = c ? ` You're in ${c.keyLabel}, by the way — ask me for a progression or a riff and I'll just build one.` : "";
        return this._voice("I don't have a clean answer locked in for that one. Ask me about scales, chord progressions, " +
          "why something sounds good, hooks, riffs, tunings, or fixing buzz/intonation on your guitar." + keyLine);
      }
      let body = hits[0].content;
      if (hits[1] && hits[1].id !== hits[0].id) body += " Also — " + hits[1].content;
      return this._voice(body);
    },
    _voice(text) {
      const o = OPENERS[Math.floor(Math.random() * OPENERS.length)];
      const c = CLOSERS[Math.floor(Math.random() * CLOSERS.length)];
      return `${o} ${text} ${c}`;
    },

    /* ---------- OpenAI (optional) ---------- */
    async _askOpenAI(q, key) {
      const ctx = this._bestEntries(q, 4).map((e) => `• ${e.title}: ${e.content}`).join("\n");
      const live = this._ctx();
      const liveLine = live ? `The user is currently working in ${live.keyLabel} on the ${live.tab || "?"} tab; reference it when relevant.\n` : "";
      const sys = "You are Nathan Explosion, the deep-voiced, deadpan, brutal frontman of Dethklok — but here you are a " +
        "genuinely knowledgeable music mentor and guitar tech. Speak slowly and gruffly with dark deadpan humor; use words " +
        "like 'brutal', 'metal', 'you know'. ALWAYS give accurate, genuinely useful music-theory / songwriting / " +
        "instrument-setup advice — correctness first, character second. Keep replies to 2-5 sentences. Stay on music, " +
        "instruments and songwriting. No slurs, no explicit content. " + liveLine +
        "Use the reference notes when relevant:\n" + ctx;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.8,
          max_tokens: 220,
          messages: [{ role: "system", content: sys }].concat(this.history.slice(-8)),
        }),
      });
      if (!res.ok) throw new Error("openai " + res.status);
      const data = await res.json();
      const txt = data.choices && data.choices[0] && data.choices[0].message.content;
      return txt ? txt.trim() : null;
    },

    connectKey() {
      const cur = localStorage.getItem(KEY_STORE) || "";
      const k = window.prompt(
        "Paste your OpenAI API key to let Nathan answer freely (stored only in this browser).\n" +
        "Leave blank and OK to remove it. He works offline without one.\n\n" +
        "Heads up: a browser-stored key is visible in this browser — use a key with limited scope.", cur);
      if (k === null) return;
      const v = k.trim();
      if (v) { localStorage.setItem(KEY_STORE, v); this.addMsg("nathan", this._voice("OpenAI's plugged in. Now we can really talk.")); }
      else { localStorage.removeItem(KEY_STORE); this.addMsg("nathan", this._voice("Key's gone. Back to my offline brain. Still brutal.")); }
    },
  };

  root.Nathan = Nathan;
  document.addEventListener("DOMContentLoaded", () => Nathan.mount());

  // dev/verification helper: ?nathanOpen=1 auto-opens the chat for screenshots
  document.addEventListener("DOMContentLoaded", () => {
    try {
      if (/[?&]nathanOpen=1/.test(location.search)) setTimeout(() => Nathan.toggle(true), 400);
    } catch (e) {}
  });
})(typeof window !== "undefined" ? window : globalThis);
