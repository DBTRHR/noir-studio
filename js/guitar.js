/* =====================================================================
   NOIR Studio — Guitar fretboard view
   Renders strings for the current tuning, highlights scale notes,
   supports any tuning (presets + per-string custom), plays guitar
   samples and feeds the looper.
   ===================================================================== */
(function (root) {
  "use strict";

  const FRETS = 15;             // frets 1..15 shown plus open (0)
  const MARKERS = [3, 5, 7, 9, 15];
  const DOUBLE = [12];

  const Guitar = {
    app: null,
    el: null,
    tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], // low -> high

    mount(app) {
      this.app = app;
      this.el = document.getElementById("fretboard");
      this.tuning = app.state.tuning.slice();
      this.build();
      this.refresh();
      app.on("change", () => this.refresh());
      app.on("tuning", (t) => { this.tuning = t.slice(); this.build(); this.refresh(); });
    },

    _noteAt(openNote, fret) {
      // openNote like "E2" -> compute pitch class + octave at fret
      const m = openNote.match(/^([A-G]#?b?)(\d)$/);
      const pc = Theory.noteIndex(m[1]);
      const oct = parseInt(m[2], 10);
      const abs = pc + oct * 12 + fret;
      const newPc = ((abs % 12) + 12) % 12;
      const newOct = Math.floor(abs / 12);
      return { pc: newPc, octave: newOct };
    },

    build() {
      const fb = this.el;
      fb.innerHTML = "";
      this.cellEls = [];

      const grid = document.createElement("div");
      grid.className = "fb-grid";
      grid.style.gridTemplateColumns = `64px repeat(${FRETS + 1}, 1fr)`;

      // Header row: fret numbers
      grid.appendChild(this._cell("", "fb-corner"));
      for (let f = 0; f <= FRETS; f++) {
        const h = this._cell(f === 0 ? "0" : String(f), "fb-fretnum");
        if (MARKERS.includes(f)) h.classList.add("marker");
        if (DOUBLE.includes(f)) h.classList.add("marker-double");
        grid.appendChild(h);
      }

      // String rows: render high string at top (reverse low->high)
      const rows = this.tuning.slice().reverse();
      rows.forEach((openNote) => {
        const lbl = this._cell(openNote, "fb-string-label");
        grid.appendChild(lbl);
        for (let f = 0; f <= FRETS; f++) {
          const info = this._noteAt(openNote, f);
          const fullNote = Theory.SHARP[info.pc] + info.octave;
          const cell = document.createElement("div");
          cell.className = "fb-cell" + (f === 0 ? " open-fret" : "");
          const dot = document.createElement("span");
          dot.className = "fb-dot";
          cell.appendChild(dot);
          cell.dataset.note = fullNote;
          cell.dataset.pc = info.pc;
          this.cellEls.push({ cell, dot, pc: info.pc, fullNote });

          const press = (e) => {
            e.preventDefault();
            this.app.startAudio();
            const sound = this.app.state.guitarSound; // acoustic | electric
            AudioEngine.play(fullNote, "2n", 0.8, undefined, sound);
            dot.classList.add("pluck");
            this.app.noteHit(fullNote, sound);
            setTimeout(() => dot.classList.remove("pluck"), 250);
          };
          cell.addEventListener("mousedown", press);
          cell.addEventListener("touchstart", press, { passive: false });
          grid.appendChild(cell);
        }
      });

      fb.appendChild(grid);
    },

    _cell(text, cls) {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = text;
      return d;
    },

    refresh() {
      const pcs = this.app.scalePitchClasses();
      const rootPc = Theory.noteIndex(this.app.state.root);
      const names = this.app.scaleNoteNames();
      const showAll = this.app.state.showAllFret;
      this.cellEls.forEach(({ cell, dot, pc }) => {
        const inScale = pcs.has(pc);
        const isRoot = pc === rootPc;
        cell.classList.toggle("in-scale", inScale);
        cell.classList.toggle("is-root", isRoot);
        if (inScale) {
          dot.textContent = this._spell(pc, names);
          dot.style.opacity = "1";
        } else if (showAll) {
          dot.textContent = Theory.SHARP[pc];
          dot.style.opacity = "0.18";
        } else {
          dot.textContent = "";
          dot.style.opacity = "0";
        }
      });
    },

    _spell(pc, names) {
      const found = names.find((n) => Theory.noteIndex(n) === pc);
      return found || Theory.SHARP[pc];
    },

    // Pulse every fret position matching this note (sharp + octave)
    flash(noteName) {
      if (!this.cellEls) return;
      this.cellEls.forEach(({ cell, dot, fullNote }) => {
        if (fullNote === noteName) {
          dot.classList.add("pluck");
          cell.classList.add("flash");
          setTimeout(() => { dot.classList.remove("pluck"); cell.classList.remove("flash"); }, 220);
        }
      });
    },
  };

  root.Guitar = Guitar;
})(typeof window !== "undefined" ? window : globalThis);
