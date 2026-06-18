/* =====================================================================
   NOIR Studio — Picture Chord Book
   Generates real chord diagrams (SVG) for any root + quality using open
   shapes where possible, movable E/A barre shapes otherwise. Diagrams
   are clickable and strum the chord with the guitar sound.
   ===================================================================== */
(function (root) {
  "use strict";

  const STD = ["E2", "A2", "D3", "G3", "B3", "E4"]; // chord book is standard tuning

  // Open / common shapes: frets low-E -> high-e, -1 = muted, 0 = open
  const OPEN = {
    "C-maj":  [-1, 3, 2, 0, 1, 0],
    "C-min":  [-1, 3, 1, 0, 1, -1],
    "C-7":    [-1, 3, 2, 3, 1, 0],
    "D-maj":  [-1, -1, 0, 2, 3, 2],
    "D-min":  [-1, -1, 0, 2, 3, 1],
    "D-7":    [-1, -1, 0, 2, 1, 2],
    "E-maj":  [0, 2, 2, 1, 0, 0],
    "E-min":  [0, 2, 2, 0, 0, 0],
    "E-7":    [0, 2, 0, 1, 0, 0],
    "G-maj":  [3, 2, 0, 0, 0, 3],
    "G-min":  [3, 1, 0, 0, 3, 3],
    "G-7":    [3, 2, 0, 0, 0, 1],
    "A-maj":  [-1, 0, 2, 2, 2, 0],
    "A-min":  [-1, 0, 2, 2, 1, 0],
    "A-7":    [-1, 0, 2, 0, 2, 0],
  };

  // Movable shape templates (relative to barre fret)
  const ESHAPE = { maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0] };
  const ASHAPE = { maj: [-1, 0, 2, 2, 2, 0], min: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0] };

  const Chords = {
    app: null,
    quality: "maj",

    mount(app) {
      this.app = app;
      this.bookEl = document.getElementById("chord-book");
      this.keyChordsEl = document.getElementById("key-chords");
      this.qualBtns = document.querySelectorAll("[data-chord-quality]");
      this.qualBtns.forEach((b) =>
        b.addEventListener("click", () => {
          this.quality = b.dataset.chordQuality;
          this.qualBtns.forEach((x) => x.classList.toggle("active", x === b));
          this.renderBook();
        })
      );
      this.renderBook();
      this.renderKeyChords();
      app.on("change", () => this.renderKeyChords());
    },

    buildChord(rootPc, quality) {
      const rootName = Theory.SHARP[rootPc];
      const key = rootName + "-" + quality;
      if (OPEN[key]) return { frets: OPEN[key], label: rootName + this._suffix(quality) };

      // E-shape barre
      const eFret = Theory.mod(rootPc - 4, 12);
      const aFret = Theory.mod(rootPc - 9, 12);
      let frets, barreFret;
      if (eFret <= aFret) {
        frets = ESHAPE[quality].map((v) => v + eFret);
        barreFret = eFret;
      } else {
        frets = ASHAPE[quality].map((v) => (v < 0 ? -1 : v + aFret));
        barreFret = aFret;
      }
      return { frets, label: rootName + this._suffix(quality), barre: barreFret };
    },

    _suffix(q) { return q === "maj" ? "" : q === "min" ? "m" : "7"; },

    _notesFromFrets(frets) {
      const notes = [];
      frets.forEach((f, i) => {
        if (f < 0) return;
        const m = STD[i].match(/^([A-G]#?)(\d)$/);
        const pc = Theory.noteIndex(m[1]);
        const oct = parseInt(m[2], 10);
        const abs = pc + oct * 12 + f;
        notes.push(Theory.SHARP[((abs % 12) + 12) % 12] + Math.floor(abs / 12));
      });
      return notes;
    },

    drawDiagram(label, frets) {
      const positive = frets.filter((f) => f > 0);
      const maxF = positive.length ? Math.max(...positive) : 0;
      const minF = positive.length ? Math.min(...positive) : 0;
      const baseFret = maxF > 4 ? minF : 1;
      const NS = "http://www.w3.org/2000/svg";
      const W = 110, H = 140, padX = 16, padTop = 30, fw = (W - 2 * padX) / 5, fh = 84 / 5;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.classList.add("chord-svg");

      // strings (6 vertical) and frets (6 horizontal)
      for (let s = 0; s < 6; s++) {
        const x = padX + s * fw;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", x); line.setAttribute("y1", padTop);
        line.setAttribute("x2", x); line.setAttribute("y2", padTop + 84);
        line.setAttribute("class", "cd-string");
        svg.appendChild(line);
      }
      for (let f = 0; f <= 5; f++) {
        const y = padTop + f * fh;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", padX); line.setAttribute("y1", y);
        line.setAttribute("x2", W - padX); line.setAttribute("y2", y);
        line.setAttribute("class", f === 0 && baseFret === 1 ? "cd-nut" : "cd-fret");
        svg.appendChild(line);
      }

      if (baseFret > 1) {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", padX - 6); t.setAttribute("y", padTop + fh - 2);
        t.setAttribute("class", "cd-basefret"); t.setAttribute("text-anchor", "end");
        t.textContent = baseFret + "fr";
        svg.appendChild(t);
      }

      frets.forEach((f, s) => {
        const x = padX + s * fw;
        if (f < 0) {
          this._mark(svg, NS, x, padTop - 10, "×", "cd-mute");
        } else if (f === 0) {
          this._mark(svg, NS, x, padTop - 10, "○", "cd-open");
        } else {
          const row = f - baseFret;
          const cy = padTop + row * fh + fh / 2;
          const dot = document.createElementNS(NS, "circle");
          dot.setAttribute("cx", x); dot.setAttribute("cy", cy);
          dot.setAttribute("r", 6.5); dot.setAttribute("class", "cd-dot");
          svg.appendChild(dot);
        }
      });

      const wrap = document.createElement("button");
      wrap.className = "chord-card glass";
      wrap.appendChild(svg);
      const cap = document.createElement("div");
      cap.className = "chord-name";
      cap.textContent = label;
      wrap.appendChild(cap);
      wrap.addEventListener("click", () => {
        this.app.startAudio();
        const notes = this._notesFromFrets(frets);
        AudioEngine.strum(notes, "1n", 0.78, this.app.state.guitarSound);
      });
      return wrap;
    },

    _mark(svg, NS, x, y, txt, cls) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x); t.setAttribute("y", y);
      t.setAttribute("text-anchor", "middle"); t.setAttribute("class", cls);
      t.textContent = txt;
      svg.appendChild(t);
    },

    renderBook() {
      const c = this.bookEl;
      c.innerHTML = "";
      for (let pc = 0; pc < 12; pc++) {
        const { frets, label } = this.buildChord(pc, this.quality);
        c.appendChild(this.drawDiagram(label, frets));
      }
    },

    renderKeyChords() {
      const c = this.keyChordsEl;
      if (!c) return;
      c.innerHTML = "";
      const chords = Theory.diatonicChords(this.app.state.root, this.app.state.scale);
      if (!chords.length) {
        c.innerHTML = `<p class="muted">Diatonic chords show for 7-note scales (major, minor, modes). Pick one of those to see the chords in this key.</p>`;
        return;
      }
      chords.forEach((ch) => {
        const pill = document.createElement("button");
        pill.className = "chord-pill glass";
        pill.innerHTML = `<span class="roman">${ch.roman}</span>
          <span class="sym">${ch.symbol}</span>
          <span class="notes">${ch.notes.join(" · ")}</span>`;
        pill.addEventListener("click", () => {
          this.app.startAudio();
          const inst = this.app.currentSound();
          // ascending triad voicing starting at octave 3
          let oct = 3, prev = -1;
          const notes = ch.notes.map((n) => {
            const pc = Theory.noteIndex(n);
            if (prev >= 0 && pc <= prev) oct++;
            prev = pc;
            return Theory.withOctave(n, oct);
          });
          AudioEngine.strum(notes, "1n", 0.8, inst);
        });
        c.appendChild(pill);
      });
    },
  };

  root.Chords = Chords;
})(typeof window !== "undefined" ? window : globalThis);
