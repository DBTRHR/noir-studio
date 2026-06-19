/* =====================================================================
   NOIR Studio — Piano keyboard view
   Renders a multi-octave keyboard, highlights the active scale,
   plays notes (piano sound), and feeds the looper while recording.
   ===================================================================== */
(function (root) {
  "use strict";

  const WHITE = ["C", "D", "E", "F", "G", "A", "B"];
  const BLACK_AFTER = { C: "C#", D: "D#", F: "F#", G: "G#", A: "A#" };

  // ---- Computer-keyboard play: two stacked rows = two octaves at once ----
  // BOTTOM row  (lower octave)  : Z X C V B N M , . /        (10 keys, slot 0..9)
  // HOME row    (octave above)  : A S D F G H J K L ; '       (11 keys, slot 0..10)
  // TOP row     Q W E (R..P)    : RESERVED — never mapped to notes (looper later).
  //
  // Each entry carries a "slot" (position along the row) and "rowUp" (0 = bottom
  // octave, 1 = the octave above). Both modes share this geometry; only the
  // slot -> note resolution differs (see _noteForEntry / _chromaticNote).
  const BOTTOM_ROW = [
    { code: "KeyZ",   letter: "Z" },
    { code: "KeyX",   letter: "X" },
    { code: "KeyC",   letter: "C" },
    { code: "KeyV",   letter: "V" },
    { code: "KeyB",   letter: "B" },
    { code: "KeyN",   letter: "N" },
    { code: "KeyM",   letter: "M" },
    { code: "Comma",  letter: "," },
    { code: "Period", letter: "." },
    { code: "Slash",  letter: "/" },
  ];
  const HOME_ROW = [
    { code: "KeyA",      letter: "A" },
    { code: "KeyS",      letter: "S" },
    { code: "KeyD",      letter: "D" },
    { code: "KeyF",      letter: "F" },
    { code: "KeyG",      letter: "G" },
    { code: "KeyH",      letter: "H" },
    { code: "KeyJ",      letter: "J" },
    { code: "KeyK",      letter: "K" },
    { code: "KeyL",      letter: "L" },
    { code: "Semicolon", letter: ";" },
    { code: "Quote",     letter: "'" },
  ];
  // Unified map. rowUp: 0 = bottom (playOctave), 1 = home (playOctave + 1).
  const KEYMAP = BOTTOM_ROW.map((k, i) => ({ ...k, slot: i, rowUp: 0 }))
    .concat(HOME_ROW.map((k, i) => ({ ...k, slot: i, rowUp: 1 })));

  const KB_STORE = "noir.kbPlay";
  const MODE_STORE = "noir.kbMode";   // "chromatic" | "inkey"

  const Piano = {
    app: null,
    el: null,
    startOctave: 3,
    endOctave: 5,        // inclusive; we also add the final C
    keyEls: {},          // note(with octave) -> element
    playOctave: 4,       // base octave the BOTTOM row plays from (home row = +1)
    kbEnabled: true,     // computer-keyboard play on/off (persisted)
    kbMode: "chromatic", // "chromatic" | "inkey" (persisted)
    _heldCodes: {},      // code -> note currently held (to release pressed class)

    mount(app) {
      this.app = app;
      this.el = document.getElementById("piano-board");
      try { this.kbEnabled = localStorage.getItem(KB_STORE) !== "off"; } catch (e) {}
      try {
        const m = localStorage.getItem(MODE_STORE);
        if (m === "inkey" || m === "chromatic") this.kbMode = m;
      } catch (e) {}
      this.build();
      this.refresh();
      this.buildLegend();
      this.bindKeyboard();
      app.on("change", () => { this.refresh(); this.paintKeyBadges(); });
      app.on("octave", (o) => {
        this.startOctave = o; this.endOctave = o + 2;
        // Keep both play rows on visible keys: prefer the new low octave.
        this.playOctave = this._clampOct(o);
        this.build(); this.refresh(); this.paintKeyBadges(); this.updateLegend();
      });
    },

    /* ---------- computer-keyboard play (two stacked octaves) ---------- */
    // The home row plays playOctave + 1, so keep playOctave low enough that the
    // upper octave still maps onto rendered keys (board spans startOctave..endOctave).
    _clampOct(o) {
      const hi = Math.max(this.startOctave, this.endOctave - 1);
      return Math.max(this.startOctave, Math.min(hi, o));
    },

    // Resolve a KEYMAP entry to an actual note name for the active mode.
    _noteForEntry(entry) {
      return this.kbMode === "inkey"
        ? this._inKeyNote(entry)
        : this._chromaticNote(entry);
    },

    // IN-KEY: bottom row = scale degrees 1..7 (+ , . / continue into next octave),
    // home row = the same degrees one octave higher (+ K L ; ' continue).
    // Built from two octaves of scale notes so the rows truly stack an octave apart.
    _inKeyNote(entry) {
      const base = this.app.scaleNotesWithOctaves(this.playOctave);     // deg1..deg7 (+tonic)
      const up   = this.app.scaleNotesWithOctaves(this.playOctave + 1); // one octave higher
      const up2  = this.app.scaleNotesWithOctaves(this.playOctave + 2); // headroom for overflow
      const pool = base.slice(0, 7).concat(up.slice(0, 7), up2.slice(0, 7)); // 21 notes
      // Bottom row starts at degree 0; home row starts one octave (7 degrees) up.
      let idx = entry.slot + entry.rowUp * 7;
      idx = Math.max(0, Math.min(pool.length - 1, idx));
      return pool[idx];
    },

    // CHROMATIC: each row ascends by semitone from its octave's C.
    //   bottom row = C..A  of playOctave     (slots 0..9)
    //   home row   = C..A# of playOctave + 1 (slots 0..10)
    // Every pitch class (incl. E natural and all sharps) is reachable.
    _chromaticNote(entry) {
      const oct = this.playOctave + entry.rowUp;
      const pc = entry.slot % 12;
      const carry = Math.floor(entry.slot / 12); // slots never exceed 10, so carry is 0
      return Theory.SHARP[pc] + (oct + carry);
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

        // octave shift — Right Shift = up, Left Shift = down (Shift fires keydown).
        // [ ] and arrow keys remain aliases. Ignore auto-repeat for these too.
        if (e.code === "ShiftRight" || e.code === "BracketRight" || e.code === "ArrowUp") {
          if (!e.repeat) this.shiftPlayOctave(1); e.preventDefault(); return;
        }
        if (e.code === "ShiftLeft" || e.code === "BracketLeft" || e.code === "ArrowDown") {
          if (!e.repeat) this.shiftPlayOctave(-1); e.preventDefault(); return;
        }

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

    setKbMode(mode) {
      const m = mode === "inkey" ? "inkey" : "chromatic";
      this.kbMode = m;
      try { localStorage.setItem(MODE_STORE, m); } catch (e) {}
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
        // If two computer keys land on the same on-screen key, stack the letters.
        let badge = el.querySelector(".kb-badge");
        if (badge) {
          badge.textContent += " " + entry.letter;
        } else {
          badge = document.createElement("span");
          badge.className = "kb-badge";
          badge.textContent = entry.letter;
          el.appendChild(badge);
        }
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
        <div class="kb-mode" role="group" aria-label="Keyboard play mode">
          <button type="button" class="kb-mode-btn" data-mode="chromatic"
            aria-pressed="${this.kbMode === "chromatic"}">Chromatic</button>
          <button type="button" class="kb-mode-btn" data-mode="inkey"
            aria-pressed="${this.kbMode === "inkey"}">In-key</button>
        </div>
        <span class="kb-legend-text" id="kb-legend-text">${this._legendText()}</span>`;
      panel.appendChild(wrap);
      const input = wrap.querySelector("#kb-toggle-input");
      input.addEventListener("change", () => this.setKbEnabled(input.checked));
      wrap.querySelectorAll(".kb-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => this.setKbMode(btn.dataset.mode));
      });
      this.updateLegend();
      this.paintKeyBadges();
    },

    _legendText() {
      const rows = "Bottom <b>Z X C V B N M , . /</b> · Home <b>A S D F G H J K L ; '</b> (octave up)";
      const desc = this.kbMode === "inkey"
        ? "playing the <b>scale degrees</b> of your key"
        : "playing <b>every chromatic note</b> (all sharps reachable)";
      return `${rows} — ${desc}
        · <b>R-Shift</b>/<b>L-Shift</b> (or <b>[ ]</b>, <b>↑ ↓</b>) octave
        · Octave <b id="kb-oct-val">${this.playOctave}</b>`;
    },

    updateLegend() {
      const txt = document.getElementById("kb-legend-text");
      if (txt) txt.innerHTML = this._legendText();
      const input = document.getElementById("kb-toggle-input");
      if (input) input.checked = this.kbEnabled;
      const wrap = document.getElementById("kb-legend");
      if (wrap) {
        wrap.classList.toggle("kb-off", !this.kbEnabled);
        wrap.querySelectorAll(".kb-mode-btn").forEach((btn) => {
          btn.setAttribute("aria-pressed", String(btn.dataset.mode === this.kbMode));
        });
      }
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
