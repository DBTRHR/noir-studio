/* =====================================================================
   NOIR Studio — Learn Scales
   Lists every scale/mode, teaches the step pattern, degrees and feel,
   and plays the scale ascending+descending lighting up the instrument.
   ===================================================================== */
(function (root) {
  "use strict";

  const BLURBS = {
    major: "The happy, resolved sound. The foundation of Western music — bright and stable.",
    minor: "The natural sad sound. Same notes as its relative major, started a 6th higher.",
    harmonicMinor: "Minor with a raised 7th — exotic, classical, tense. That big leap to the 7th is the drama.",
    melodicMinor: "Minor going up, natural minor coming down (jazz uses it both ways). Smooth, sophisticated.",
    dorian: "Minor with a bright raised 6th. Cool, jazzy, hopeful-sad. Think 'So What' and funk.",
    phrygian: "Minor with a dark lowered 2nd. Spanish, flamenco, metal. Instantly sinister.",
    lydian: "Major with a dreamy raised 4th. Floating, magical, film-score wonder.",
    mixolydian: "Major with a bluesy lowered 7th. Dominant, rock, country. Anthemic.",
    locrian: "The unstable one — diminished tonic. Rarely a tonal home; great for tension.",
    majorPentatonic: "5 notes, no half-steps, no wrong notes. Bright and singable.",
    minorPentatonic: "The rock/blues workhorse. 5 notes that always sound good over minor.",
    blues: "Minor pentatonic + the 'blue note' (b5). Gritty, vocal, expressive.",
    phrygianDominant: "5th mode of harmonic minor — flamenco + metal. Exotic and dark.",
  };

  const Scales = {
    app: null,

    mount(app) {
      this.app = app;
      this.listEl = document.getElementById("scale-list");
      this.detailEl = document.getElementById("scale-detail");
      this.renderList();
      this.renderDetail();
      app.on("change", () => { this.renderList(); this.renderDetail(); });
    },

    renderList() {
      const c = this.listEl;
      c.innerHTML = "";
      Object.entries(Theory.SCALES).forEach(([id, def]) => {
        const b = document.createElement("button");
        b.className = "scale-item glass" + (id === this.app.state.scale ? " active" : "");
        b.textContent = def.name;
        b.addEventListener("click", () => this.app.setScale(id));
        c.appendChild(b);
      });
    },

    _stepPattern(intervals) {
      const steps = [];
      for (let i = 1; i < intervals.length; i++) steps.push(intervals[i] - intervals[i - 1]);
      steps.push(12 - intervals[intervals.length - 1]);
      return steps.map((s) => (s === 1 ? "H" : s === 2 ? "W" : s === 3 ? "1½" : s + "s")).join(" – ");
    },

    renderDetail() {
      const id = this.app.state.scale;
      const def = Theory.SCALES[id];
      const notes = this.app.scaleNoteNames();
      const degrees = notes.map((n, i) => `<span class="deg"><b>${i + 1}</b>${n}</span>`).join("");
      this.detailEl.innerHTML = `
        <div class="scale-detail-head">
          <h3>${this.app.state.root} ${def.name}</h3>
          <button id="play-scale" class="btn-accent">▶ Play scale</button>
        </div>
        <p class="scale-blurb">${BLURBS[id] || ""}</p>
        <div class="scale-degrees">${degrees}</div>
        <div class="scale-steps"><span class="muted">Step pattern:</span> ${this._stepPattern(def.intervals)}</div>
      `;
      this.detailEl.querySelector("#play-scale").addEventListener("click", () => this.play());
    },

    play() {
      this.app.startAudio();
      const notes = this.app.scaleNotesWithOctaves(4); // ascending one octave
      const full = notes.concat(notes.slice(0, -1).reverse());
      const inst = this.app.currentSound();
      const t0 = AudioEngine.now() + 0.05;
      const dt = 0.32;
      full.forEach((n, i) => {
        AudioEngine.play(n, "8n", 0.85, t0 + i * dt, inst);
        const delay = (t0 + i * dt - AudioEngine.now()) * 1000;
        setTimeout(() => this.app.flashNote(n), Math.max(0, delay));
      });
    },
  };

  root.Scales = Scales;
})(typeof window !== "undefined" ? window : globalThis);
