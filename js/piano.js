/* =====================================================================
   NOIR Studio — Piano keyboard view
   Renders a multi-octave keyboard, highlights the active scale,
   plays notes (piano sound), and feeds the looper while recording.
   ===================================================================== */
(function (root) {
  "use strict";

  const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
  const BLACK_AFTER = { C: "C#", D: "D#", F: "F#", G: "G#", A: "A#" };

  // Computer-keyboard play map: bottom QWERTY row -> scale degrees (ear-first).
  // Z X C V B N M = degrees 1..7 of the play-octave; , . / = degrees 1,2,3 one octave up.
  const KEYMAP = [
    { code: "KeyZ", letter: "Z", degree: 0, octUp: 0 },
    { code: "KeyX", letter: "X", degree: 1, octUp: 0 },
    { code: "KeyC", letter: "C", degree: 2, octUp: 0 },
    { code: "KeyV", letter: "V", degree: 3, octUp: 0 },
    { code: "KeyB", letter: "B", degree: 4, octUp: 0 },
    { code: "KeyN", letter: "N", degree: 5, octUp: 0 },
    { code: "KeyM", letter: "M", degree: 6, octUp: 0 },
    { code: "Comma",  letter: ",", degree: 0, octUp: 1 },
    { code: "Period", letter: ".", degree: 1, octUp: 1 },
    { code: "Slash",  letter: "/", degree: 2, octUp: 1 },
  ];
  const KB_STORE = "noir.kbPlay";

  const Piano = {
    app: null,
    el: null,
    startOctave: 3,
    endOctave: 5,        // inclusive; we also add the final C
    keyEls: {},          // note(with octave) -> element
    playOctave: 4,       // base octave the QWERTY row plays from
    kbEnabled: true,     // computer-keyboard play on/off (persisted)
    _heldCodes: {},      // code -> note currently held (to release pressed class)

    mount(app) {
      this.app = app;
      this.el = document.getElementById("piano-board");
      try { this.kbEnabled = localStorage.getItem(KB_STORE) !== "off"; } catch (e) {}
      this.build();
      this.refresh();
      this.buildLegend();
      this.bindKeyboard();
      app.on("change", () => { this.refresh(); this.paintKeyBadges(); });
      app.on("octave", (o) => {
        this.startOctave = o; this.endOctave = o + 2;
        this.playOctave = this._clampOct(this.playOctave);
        this.build(); this.refresh(); this.paintKeyBadges(); this.updateLegend();
      });
    },

    /* ---------- computer-keyboard play (ear-first, in-key) ---------- */
    _clampOct(o) { return Math.max(this.startOctave, Math.min(this.endOctave, o)); },

    // Resolve a KEYMAP entry to an actual note name in the CURRENT key/scale.
    // scaleNotesWithOctaves(playOctave) gives degrees 1..7 (+ tonic up) with octaves.
    _noteForEntry(entry) {
      const base = this.app.scaleNotesWithOctaves(this.playOctave); // length 8: deg1..deg7 + tonic
      let idx = entry.degree + entry.octUp * 7;                     // 0..9 across two octaves
      const up = this.app.scaleNotesWithOctaves(this.playOctave + 1);
      const pool = base.slice(0, 7).concat(up.slice(0, 7));         // 14 notes, two octaves of degrees
      idx = Math.max(0, Math.min(pool.length - 1, idx));
      return pool[idx];
    },

    _pianoVisible() {
      const panel = document.querySelector('[data-panel="piano"]');
      return !!panel && panel.classList.contains("active");
    },
    _typingTarget(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    },

    bindKeyboard() {
      document.addEventListener("keydown", (e) => {
        if (!this.kbEnabled) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;     // don't hijack browser shortcuts
        if (!this._pianoVisible()) return;                  // only on the piano panel
        if (this._typingTarget(document.activeElement)) return; // let inputs/chat type normally

        // octave shift
        if (e.code === "BracketLeft" || e.code === "ArrowDown") { this.shiftPlayOctave(-1); e.preventDefault(); return; }
        if (e.code === "BracketRight" || e.code === "ArrowUp") { this.shiftPlayOctave(1); e.preventDefault(); return; }

        if (e.repeat) return;                               // ignore auto-repeat
        const entry = KEYMAP.find((k) => k.code === e.code);
        if (!entry) return;
        e.preventDefault();
        this.playFromKey(entry, e.code);
      });
      document.addEventListener("keyup", (e) => {
        const note = this._heldCodes[e.code];
        if (note && this.keyEls[note]) this.keyEls[note].classList.remove("pressed");
        delete this._heldCodes[e.code];
      });
    },

    playFromKey(entry, code) {
      const note = this._noteForEntry(entry);
      if (!note) return;
      this.app.startAudio();
      AudioEngine.play(note, "4n", 0.85, undefined, "piano");
      const el = this.keyEls[note];
      if (el) { el.classList.add("pressed"); this._heldCodes[code] = note; }
      this.app.noteHit(note, "piano");
    },

    shiftPlayOctave(d) {
      const next = this._clampOct(this.playOctave + d);
      if (next === this.playOctave) return;
      this.playOctave = next;
      this.paintKeyBadges();
      this.updateLegend();
    },

    setKbEnabled(on) {
      this.kbEnabled = on;
      try { localStorage.setItem(KB_STORE, on ? "on" : "off"); } catch (e) {}
      this.paintKeyBadges();
      this.updateLegend();
    },

    build() {
      const board = this.el;
      board.innerHTML = "";
      this.keyEls = {};

      // Build ordered note list
      const notes = [];
      for (let oct = this.startOctave; oct <= this.endOctave; oct++) {
        WHITE.forEach((w) => {
          notes.push({ name: w + oct, white: true });
          if (BLACK_AFTER[w]) notes.push({ name: BLACK_AFTER[w] + oct, white: false });
        });
      }
      notes.push({ name: "C" + (this.endOctave + 1), white: true }); // top C

      const whites = notes.filter((n) => n.white);
      const whiteW = 100 / whites.length;

      const whiteLayer = document.createElement("div");
      whiteLayer.className = "kb-white-layer";
      const blackLayer = document.createElement("div");
      blackLayer.className = "kb-black-layer";

      let whiteIdx = -1;
      notes.forEach((n) => {
        if (n.white) {
          whiteIdx++;
          const k = this._key(n.name, true);
          k.style.width = whiteW + "%";
          whiteLayer.appendChild(k);
        } else {
          const k = this._key(n.name, false);
          k.style.width = whiteW * 0.62 + "%";
          k.style.left = `calc(${(whiteIdx + 1) * whiteW}% - ${whiteW * 0.31}%)`;
          blackLayer.appendChild(k);
        }
      });

      board.appendChild(whiteLayer);
      board.appendChild(blackLayer);
    },

    _key(noteName, isWhite) {
      const k = document.createElement("div");
      k.className = "key " + (isWhite ? "white" : "black");
      k.dataset.note = noteName;
      const label = document.createElement("span");
      label.className = "key-label";
      k.appendChild(label);
      this.keyEls[noteName] = k;

      const press = (e) => {
        e.preventDefault();
        this.app.startAudio();
        const vel = isWhite ? 0.85 : 0.8;
        AudioEngine.play(noteName, "4n", vel, undefined, "piano");
        k.classList.add("pressed");
        this.app.noteHit(noteName, "piano");
        setTimeout(() => k.classList.remove("pressed"), 220);
      };
      k.addEventListener("mousedown", press);
      k.addEventListener("touchstart", press, { passive: false });
      return k;
    },

    refresh() {
      const pcs = this.app.scalePitchClasses();
      const rootPc = Theory.noteIndex(this.app.state.root);
      const names = this.app.scaleNoteNames();
      const showLabels = this.app.state.showLabels;
      Object.entries(this.keyEls).forEach(([note, el]) => {
        const pc = Theory.noteIndex(note);
        const inScale = pcs.has(pc);
        el.classList.toggle("in-scale", inScale);
        el.classList.toggle("is-root", pc === rootPc);
        const label = el.querySelector(".key-label");
        if (showLabels && inScale) {
          // Use the spelled scale name (e.g. Bb instead of A#)
          const idx = [...pcs].sort((a, b) => a - b);
          label.textContent = this._spell(pc, names);
        } else {
          label.textContent = "";
        }
      });
    },

    _spell(pc, names) {
      const found = names.find((n) => Theory.noteIndex(n) === pc);
      return found || Theory.SHARP[pc];
    },

    /* ---------- key-letter badges (draw QWERTY letter on mapped keys) ---------- */
    paintKeyBadges() {
      // clear old badges
      Object.values(this.keyEls).forEach((el) => {
        const b = el.querySelector(".kb-badge");
        if (b) b.remove();
        el.classList.remove("kb-mapped");
      });
      if (!this.kbEnabled) return;
      KEYMAP.forEach((entry) => {
        const note = this._noteForEntry(entry);
        const el = this.keyEls[note];
        if (!el) return;
        const badge = document.createElement("span");
        badge.className = "kb-badge";
        badge.textContent = entry.letter;
        el.appendChild(badge);
        el.classList.add("kb-mapped");
      });
    },

    /* ---------- on-screen legend ---------- */
    buildLegend() {
      const panel = document.querySelector('[data-panel="piano"]');
      if (!panel || document.getElementById("kb-legend")) { this.paintKeyBadges(); return; }
      const wrap = document.createElement("div");
      wrap.id = "kb-legend";
      wrap.className = "kb-legend";
      wrap.innerHTML = `
        <label class="kb-toggle">
          <input type="checkbox" id="kb-toggle-input" ${this.kbEnabled ? "checked" : ""}>
          <span>⌨ Keyboard play</span>
        </label>
        <span class="kb-legend-text">Type <b>Z X C V B N M , . /</b> to play your key
          · <b>[ ]</b> or <b>↑ ↓</b> octave
          · Octave <b id="kb-oct-val">${this.playOctave}</b></span>`;
      panel.appendChild(wrap);
      const input = wrap.querySelector("#kb-toggle-input");
      input.addEventListener("change", () => this.setKbEnabled(input.checked));
      this.paintKeyBadges();
    },
    updateLegend() {
      const v = document.getElementById("kb-oct-val");
      if (v) v.textContent = this.playOctave;
      const input = document.getElementById("kb-toggle-input");
      if (input) input.checked = this.kbEnabled;
      const wrap = document.getElementById("kb-legend");
      if (wrap) wrap.classList.toggle("kb-off", !this.kbEnabled);
    },

    // Visual + audio flash (used by riff player / looper playback)
    flash(noteName) {
      const base = noteName;
      const el = this.keyEls[base];
      if (el) { el.classList.add("pressed"); setTimeout(() => el.classList.remove("pressed"), 200); }
    },
  };

  root.Piano = Piano;
})(typeof window !== "undefined" ? window : globalThis);
