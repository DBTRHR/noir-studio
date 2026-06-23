/* =====================================================================
   NOIR Studio — CROSS-SURFACE WIRING
   Glues the new engine capabilities onto existing surfaces WITHOUT
   rewriting them:
     • Spark-everywhere  — a Spark button on piano/guitar/riff/studio
     • Notes ⇄ Chords    — piano & guitar can place/play chords too
     • Click-to-listen   — chord pills + scale degrees audition
     • Send-to buttons   — push a progression/scale into Studio or Riff Writer

   Reuses, never reinvents:
     Spark.roll / current / progToLooper / openRiff       → spark engine
     Theory.diatonicChords / chordForDegree / voiceChord  → chords
     AudioEngine.play / strum                             → the app's audio path
     Riff / Looper / App                                  → existing modules
   ===================================================================== */
(function (root) {
  "use strict";

  const Wiring = {
    app: null,
    // per-surface "notes" | "chords" play mode (piano, guitar)
    ncMode: { piano: "notes", guitar: "notes" },

    mount(app) {
      this.app = app;
      this._wireSparkEverywhere();
      this._wireNotesChordsToggle();
      this._interceptChordPlay("piano", "piano-board");
      this._interceptChordPlay("guitar", "fretboard");
      this._wireScaleAudition();
      this._wireChordSendButtons();
      // Scales panel re-renders on key change → re-wire degree auditions.
      app.on("change", () => setTimeout(() => this._wireScaleAudition(), 0));
    },

    _inst() {
      return this.app.state.instrument === "guitar" ? this.app.state.guitarSound : "piano";
    },

    /* =================================================================
       1) SPARK EVERYWHERE
       Each [data-spark-here] button rolls a fresh Spark idea (which sets
       the key app-wide + builds a progression + riff) and loads it into
       the surface it lives on.
       ================================================================= */
    _wireSparkEverywhere() {
      document.querySelectorAll("[data-spark-here]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const where = btn.dataset.sparkHere;
          if (!root.Spark) { this.app.toast("Spark not ready"); return; }
          this.app.startAudio();
          Spark.roll();                 // sets key + builds current idea
          const idea = Spark.current;
          if (!idea) return;

          if (where === "riff") {
            if (idea.riff && idea.riff.length) Spark.openRiff(idea.riff);
            else this.app.toast("Sparked a key — generate a riff");
          } else if (where === "studio") {
            if (idea.prog && idea.prog.chords && idea.prog.chords.length)
              Spark.progToLooper(idea.prog.chords, idea);
            else this.app.toast("Sparked a key for the Studio");
          } else {
            // piano / guitar — the key is already applied app-wide; just
            // audition the progression so the user hears the new idea here.
            if (idea.prog && idea.prog.chords) Spark.playProg(idea.prog.chords);
            this.app.toast(`✦ ${idea.emoji || ""} ${idea.mood} idea ready — play along`);
          }
        });
      });
    },

    /* =================================================================
       2) NOTES ⇄ CHORDS TOGGLE (piano + guitar)
       ================================================================= */
    _wireNotesChordsToggle() {
      document.querySelectorAll(".nc-toggle[data-nc]").forEach((grp) => {
        const surface = grp.dataset.nc;
        grp.querySelectorAll(".nc-btn").forEach((b) => {
          b.addEventListener("click", () => {
            const mode = b.dataset.ncMode;
            this.ncMode[surface] = mode;
            grp.querySelectorAll(".nc-btn").forEach((x) =>
              x.setAttribute("aria-pressed", String(x === b)));
          });
        });
      });
    },

    /* =================================================================
       3) CHORD-PLAY INTERCEPT for piano/guitar
       When a surface is in "chords" mode, a capture-phase listener plays
       the diatonic chord rooted on the clicked note and stops the board's
       own single-note handler. In "notes" mode it does nothing (the
       original handler runs untouched).
       ================================================================= */
    _interceptChordPlay(surface, boardId) {
      const board = document.getElementById(boardId);
      if (!board) return;
      const handler = (e) => {
        if (this.ncMode[surface] !== "chords") return;
        const cell = e.target.closest("[data-note]");
        if (!cell || !board.contains(cell)) return;
        // swallow the single-note handler
        e.preventDefault();
        e.stopPropagation();
        this._playChordForNote(cell.dataset.note);
      };
      // capture phase so we run BEFORE the board's bubble-phase mousedown
      board.addEventListener("mousedown", handler, true);
      board.addEventListener("touchstart", handler, { capture: true, passive: false });
    },

    // Build a diatonic chord rooted on the clicked note's pitch class, in the
    // current key. If the note isn't a diatonic root, fall back to a triad
    // built on it (major/minor by mood) so something musical always plays.
    _playChordForNote(noteWithOct) {
      const m = String(noteWithOct).match(/^([A-G]#?b?)(\d+)?$/);
      if (!m) return;
      const pcName = m[1];
      const oct = m[2] ? +m[2] : 4;
      const pc = Theory.noteIndex(pcName);

      const root_ = this.app.state.root, scale = this.app.state.scale;
      const chords = Theory.diatonicChords(root_, scale) || [];
      // find the diatonic degree whose root matches this pitch class
      let chord = chords.find((c) => Theory.noteIndex(c.root || c.notes[0]) === pc);

      let notes;
      if (chord) {
        notes = Theory.voiceChord(chord.notes, Math.max(2, oct - 1));
      } else {
        // not diatonic — build a triad on the note (minor in noir, major in west).
        // buildChord returns an array of note names directly.
        const quality = this.app.getMood() === "w" ? "maj" : "min";
        const raw = (Theory.buildChord ? Theory.buildChord(pcName, quality) : null) || [pcName];
        notes = Theory.voiceChord(raw, Math.max(2, oct - 1));
      }

      this.app.startAudio().then(() => {
        AudioEngine.strum(notes, "1n", 0.78, this._inst());
        // flash the notes on the active board for feedback
        notes.forEach((n) => this.app.flashNote(n));
      });
      // feed the looper if recording (mirror the board's noteHit behaviour)
      if (this.app.noteHit) notes.forEach((n) => this.app.noteHit(n, this._inst()));
    },

    /* =================================================================
       4) SCALE-DEGREE AUDITION + SEND-TO  (Scales panel)
       The scale-detail is rendered by scales.js; we enhance its degree
       chips to be clickable (play that note) and add send-to buttons.
       ================================================================= */
    _wireScaleAudition() {
      const detail = document.getElementById("scale-detail");
      if (!detail) return;
      const degs = detail.querySelectorAll(".scale-degrees .deg");
      if (!degs.length) return;

      const notesOct = this.app.scaleNotesWithOctaves(4); // deg1..deg7 (+tonic)
      degs.forEach((deg, i) => {
        if (deg._wired) return;
        deg._wired = true;
        deg.setAttribute("role", "button");
        deg.setAttribute("tabindex", "0");
        const play = () => {
          const note = notesOct[i] || notesOct[0];
          this.app.startAudio().then(() => {
            AudioEngine.play(note, "4n", 0.85, undefined, this._inst());
            this.app.flashNote(note);
          });
          deg.classList.add("audition");
          setTimeout(() => deg.classList.remove("audition"), 220);
        };
        deg.addEventListener("click", play);
        deg.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });
      });

      // add a send-row once
      if (!detail.querySelector(".send-row")) {
        const row = document.createElement("div");
        row.className = "send-row";
        row.innerHTML =
          `<button class="send-btn" data-scale-send="riff">→ Send scale to Riff Writer</button>
           <button class="send-btn" data-scale-send="studio">→ Send scale run to Studio</button>`;
        detail.appendChild(row);
        row.querySelector('[data-scale-send="riff"]').addEventListener("click", () => this._sendScaleToRiff());
        row.querySelector('[data-scale-send="studio"]').addEventListener("click", () => this._sendScaleToStudio());
      }
    },

    // Turn the current scale into a riff (ascending run) and open the writer.
    _scaleRunRiff() {
      const notes = this.app.scaleNotesWithOctaves(4);
      return notes.map((n) => ({ rest: false, note: n, dur: "8n" }));
    },

    _sendScaleToRiff() {
      if (!root.Riff) return;
      try {
        Riff.riff = this._scaleRunRiff();
        Riff.selected = null; Riff.dirty = true;
        Riff.render(); Riff.renderEditor();
      } catch (e) {}
      const tab = document.querySelector('[data-tab="riff"]');
      if (tab) tab.click();
      this.app.toast("Scale run loaded in the Riff Writer ✓");
    },

    _sendScaleToStudio() {
      if (!root.Looper) { this.app.toast("Studio not ready"); return; }
      this.app.startAudio().then(() => {
        const run = this._scaleRunRiff();
        const beat = 0.4, events = [];
        run.forEach((n, i) => events.push({ time: i * beat, note: n.note, dur: beat * 0.9, instrument: this._inst() }));
        Looper.addTrack(`Scale · ${this.app.state.root} ${Theory.SCALES[this.app.state.scale].name.split(" ")[0]}`,
          events, run.length * beat);
        this.app.toast("Scale run sent to Studio ✓");
      });
    },

    /* =================================================================
       5) CHORD-PANEL SEND-TO  (whole diatonic progression of the key)
       ================================================================= */
    _wireChordSendButtons() {
      document.querySelectorAll("[data-send-prog]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const dest = btn.dataset.sendProg;
          const chords = Theory.diatonicChords(this.app.state.root, this.app.state.scale) || [];
          if (!chords.length) { this.app.toast("Pick a 7-note scale to get chords"); return; }
          // Use a common I–V–vi–IV-ish shape from the diatonic set so it's musical.
          const idx = [0, 4, 5, 3].filter((i) => chords[i]);
          const seq = idx.map((i) => chords[i]);

          if (dest === "riff") {
            // build a simple riff from chord roots and open the writer
            const riff = seq.map((c) => ({ rest: false, note: (c.root || c.notes[0]) + "3", dur: "4n" }));
            if (root.Riff) {
              try { Riff.riff = riff; Riff.selected = null; Riff.dirty = true; Riff.render(); Riff.renderEditor(); } catch (e) {}
              const tab = document.querySelector('[data-tab="riff"]'); if (tab) tab.click();
              this.app.toast("Progression roots sent to Riff Writer ✓");
            }
          } else {
            if (!root.Looper) { this.app.toast("Studio not ready"); return; }
            this.app.startAudio().then(() => {
              const inst = this._inst();
              const beat = 1.0, events = [];
              seq.forEach((ch, i) => {
                Theory.voiceChord(ch.notes, 3).forEach((vn, j) =>
                  events.push({ time: i * beat + j * 0.02, note: vn, dur: beat * 0.92, instrument: inst }));
              });
              Looper.addTrack(`Chords · ${this.app.state.root} ${Theory.SCALES[this.app.state.scale].name.split(" ")[0]}`,
                events, seq.length * beat);
              this.app.toast("Progression sent to Studio ✓");
              const tab = document.querySelector('[data-tab="studio"]'); if (tab) tab.click();
            });
          }
        });
      });
    },
  };

  root.Wiring = Wiring;
  document.addEventListener("DOMContentLoaded", () => {
    if (root.App) Wiring.mount(root.App);
  });
})(typeof window !== "undefined" ? window : globalThis);
