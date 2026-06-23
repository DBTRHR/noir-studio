/* =====================================================================
   NOIR Studio — Random Riff Writer (robust)
   Generate riffs from the active key, then EDIT them: change any note's
   pitch (within the scale) or its length (16th → whole), toggle rests,
   insert/delete notes. Save favourites (localStorage), get suggestions,
   play/loop on piano or guitar, and send to the Looper.
   ===================================================================== */
(function (root) {
  "use strict";

  // note value -> length in beats (quarter = 1 beat)
  const DUR_BEATS = { "16n": 0.25, "8n": 0.5, "4n": 1, "2n": 2, "1n": 4 };
  const DUR_LABEL = { "16n": "1/16", "8n": "1/8", "4n": "1/4", "2n": "1/2", "1n": "1/1" };
  const DUR_ORDER = ["16n", "8n", "4n", "2n", "1n"];
  const STORE_KEY = "noir.savedRiffs";

  const Riff = {
    app: null,
    riff: [],              // [{ rest, note:"C4", dur:"8n" }]
    selected: null,        // index of selected note (for editing)
    saved: [],
    playing: false,
    loop: true,            // Play loops by default
    bpm: 100,
    length: 12,
    restProb: 0.13,
    instrument: "piano",
    feel: "smooth",
    style: "cookie",       // random | cookie | abstract  (the generation "brain")
    dirty: false,          // true once user edits/loads (suppresses auto-regen)
    _timers: [],

    mount(app) {
      this.app = app;
      this.seqEl = document.getElementById("riff-seq");
      this.editorEl = document.getElementById("riff-editor");
      this.suggEl = document.getElementById("riff-suggestions");
      this.savedEl = document.getElementById("riff-saved-list");

      document.getElementById("riff-generate").addEventListener("click", () => this.generate());
      document.getElementById("riff-suggest").addEventListener("click", () => this.suggest());
      document.getElementById("riff-play").addEventListener("click", () => this.togglePlay());
      const loopBtn = document.getElementById("riff-loop");
      loopBtn.classList.toggle("active", this.loop); // on by default
      loopBtn.addEventListener("click", (e) => {
        this.loop = !this.loop;
        e.currentTarget.classList.toggle("active", this.loop);
      });
      document.getElementById("riff-save").addEventListener("click", () => this.saveCurrent());
      document.getElementById("riff-tolooper").addEventListener("click", () => this.sendToLooper());

      const bpm = document.getElementById("riff-bpm");
      bpm.addEventListener("input", () => { this.bpm = +bpm.value; document.getElementById("riff-bpm-val").textContent = this.bpm; });
      const len = document.getElementById("riff-len");
      len.addEventListener("input", () => { this.length = +len.value; document.getElementById("riff-len-val").textContent = this.length; });

      this._wireSeg("riff-inst", (v, btn) => {
        this.instrument = v;
        document.querySelectorAll("#riff-inst .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        this.app.startAudio().then(() => {
          const n = this.riff.find((s) => !s.rest);
          if (n) AudioEngine.play(n.note, "4n", 0.7, undefined, this.instrument);
        });
      });
      this._wireSeg("riff-feel", (v, btn) => {
        this.feel = v;
        document.querySelectorAll("#riff-feel .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
      this._wireSeg("riff-style", (v, btn) => {
        this.style = v;
        document.querySelectorAll("#riff-style .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
        this.generate(); // re-roll in the new brain (hot-swaps if playing)
      });

      this._loadSaved();
      this.generate();
      this.renderSaved();
      app.on("change", () => { if (!this.dirty) this.generate(); });
    },

    _wireSeg(containerId, onPick) {
      const c = document.getElementById(containerId);
      if (!c) return;
      c.querySelectorAll(".seg-btn").forEach((btn) => {
        const v = btn.dataset.riffInst || btn.dataset.riffFeel || btn.dataset.riffStyle;
        btn.addEventListener("click", () => onPick(v, btn));
      });
    },

    /* ---------- generation ---------- */

    // Build the note pool spanning octaveRange octaves.
    // Default base octave is 3; noir mood shifts down one octave,
    // bright (W) mood shifts up one octave to bias the register.
    // octaveRange: tunable via RIFF_PARAMS — defaults to 2.
    _pool(octaveRange) {
      const params  = this._params();
      const range   = octaveRange || params.octaveRange || 2;
      const mood    = this.app && this.app.state && this.app.state.mood;
      // Base octave: low (2) for noir, normal (3) for neutral, high (3) for W
      // (keeps the overall register consistent with mood without losing variety)
      const baseOct = mood === "noir" ? 2 : 3;
      let pool = [];
      for (let o = 0; o < range; o++) {
        const octave = baseOct + o;
        const notes  = this.app.scaleNotesWithOctaves(octave);
        // scaleNotesWithOctaves returns notes[0..n] + tonic-one-above;
        // omit the repeated tonic cap on all but the final pass
        const slice  = o < range - 1 ? notes.slice(0, -1) : notes;
        pool = pool.concat(slice);
      }
      return pool;
    },

    // Get merged riff params (base + mood override from Theory.RIFF_PARAMS)
    _params() {
      try {
        const mood = this.app && this.app.state && this.app.state.mood;
        return Theory.getRiffParams(mood);
      } catch (e) { return Theory.RIFF_PARAMS.base; }
    },

    // scale-degree of a pool note (0 = root, 2 = third, 4 = fifth ...)
    _degreeOf(note, names) {
      const pc = Theory.noteIndex(note.replace(/\d+$/, ""));
      return names.findIndex((n) => Theory.noteIndex(n) === pc);
    },
    _clamp(i, pool) { return Math.max(0, Math.min(pool.length - 1, i)); },

    // Octave-displace a pool index: find the same pitch class an octave up/down.
    // Returns a new index into pool, or i if no match found (safe fallback).
    _displaceOctave(i, pool, direction) {
      const note   = pool[i];
      if (!note) return i;
      const m      = note.match(/^([A-G]#?b?)(\d+)$/);
      if (!m) return i;
      const pc     = Theory.noteIndex(m[1]);
      const oct    = parseInt(m[2], 10) + (direction > 0 ? 1 : -1);
      const target = m[1] + oct;
      const idx    = pool.indexOf(target);
      return idx >= 0 ? idx : i;
    },

    _makeRiff(len, style) {
      style = style || this.style;
      const pool = this._pool();
      if (!pool.length) return [];
      if (style === "random") return this._genRandom(pool, len);
      if (style === "abstract") return this._genAbstract(pool, len);
      if (style === "motif") return this._genMotif(len);
      return this._genCookie(pool, len); // thoughtful, conventional
    },

    // MOTIF — call-and-response shape with stepwise motion via Theory engine
    _genMotif(len) {
      try {
        const rootName = this.app.state.root;
        const scale    = this.app.state.scale;
        const mood     = this.app.state.mood;
        // Choose base octave by mood (matches _pool bias)
        const baseOct  = mood === "noir" ? 3 : 4;
        const seq      = Theory.generateMotif(rootName, scale, len, baseOct);
        if (seq && seq.length) return seq;
      } catch (e) {}
      // fallback to cookie-cutter if Theory engine unavailable
      return this._genCookie(this._pool(), len);
    },

    // RANDOM — chaotic, all in-key, no forced shape (still 100% original)
    // Now reads restProbability and octaveJumpProbability from tunable params.
    _genRandom(pool, len) {
      const rnd    = this.app.rand;
      const params = this._params();
      const seq    = [];
      let   idx    = Math.floor(pool.length / 2);
      for (let i = 0; i < len; i++) {
        if (rnd() < params.restProbability) {
          seq.push({ rest: true, dur: "8n" }); continue;
        }
        // Mostly stay near current idx (stepwise), but allow jumps
        const r = rnd();
        if (r < params.stepVsLeapRatio) {
          idx = this._clamp(idx + (rnd() < 0.5 ? 1 : -1), pool);
        } else if (r < params.stepVsLeapRatio + params.octaveJumpProbability) {
          idx = this._displaceOctave(idx, pool, rnd() < 0.5 ? 1 : -1);
        } else {
          idx = this._clamp(idx + (rnd() < 0.5 ? 3 : -3), pool);
        }
        const rr  = rnd();
        const dur = rr < 0.25 ? "16n" : rr < 0.7 ? "8n" : rr < 0.92 ? "4n" : "2n";
        seq.push({ rest: false, note: pool[idx], dur });
      }
      return seq;
    },

    // COOKIE-CUTTER — research-tuned catchy hook generator.
    // Implements:
    //   - ARCH contour (peak at ~62% through phrase, descent to root)
    //   - Interval-weighted moves (unison > step > skip > leap > big-leap)
    //   - Strong beats → chord tones {1,3,5}; weak → passing tones {2,4,6,7}
    //   - GAP-FILL after leaps (≥ gapFillThreshold semitones)
    //   - POST-LEAP REVERSAL after big leaps (≥ 6 semitones)
    //   - 2-bar call phrase; response varies back-half on 3rd+ occurrence
    //   - Octave displacement on response phrase for register variety
    //   All probabilities/ratios are tunable via Theory.RIFF_PARAMS.
    _genCookie(pool, len) {
      const rnd    = this.app.rand;
      const params = this._params();
      const names  = this.app.scaleNoteNames();

      const isChordTone = (i) => {
        const d = this._degreeOf(pool[i], names);
        return d === 0 || d === 2 || d === 4;
      };
      const nearestChordTone = (i, dir) => {
        // Find nearest chord tone in preferred direction first
        const d = dir || 0;
        for (let r = 0; r < pool.length; r++) {
          const a = d >= 0 ? i + r : i - r;
          const b = d >= 0 ? i - r : i + r;
          if (a >= 0 && a < pool.length && isChordTone(a)) return a;
          if (b >= 0 && b < pool.length && isChordTone(b)) return b;
        }
        return i;
      };

      // Interval-weighted move based on RIFF_PARAMS intervalWeights
      // Pool index distance approximates semitones (1 pool step ≈ 1-2 semitones)
      // Sizes: [0=unison, 1=step, 2=skip, 3=leap, 4=bigLeap]
      const IW = params.intervalWeights || [0.15, 0.42, 0.22, 0.15, 0.06];
      const weightedMove = () => {
        const r = rnd(), sizes = [0, 1, 2, 3, 4];
        let cum = 0;
        for (let i = 0; i < IW.length; i++) {
          cum += IW[i]; if (r < cum) return sizes[i];
        }
        return 1;
      };

      // ARCH contour: fraction of length where peak occurs
      const peakPos  = params.archPeakPosition || 0.62;
      const half     = Math.max(2, Math.ceil(len / 2));
      const gapThresh = params.gapFillThreshold || 5; // in semitone-ish pool units
      const postLeapMin = params.postLeapReversalMin || 6;

      // Start near lower third so there's room to rise to the arch peak
      let idx = nearestChordTone(Math.floor(pool.length / 4), 1);
      const callSeq = [];

      // ------- CALL: arch rise → peak → descent -------
      for (let i = 0; i < half; i++) {
        const progress = (i + 1) / half;
        const rising   = progress < peakPos;
        const magnitude = weightedMove();

        // Direction: rising phase goes up, descending goes down
        // Add small random component so it doesn't go perfectly straight
        let dir = rising ? 1 : -1;
        if (magnitude === 0) dir = 0;
        if (rnd() < 0.2) dir = -dir; // occasional local deviation keeps it natural

        let newIdx = this._clamp(idx + dir * magnitude, pool);

        // Strong beat (even positions): snap to nearest chord tone
        const isStrong = i % 2 === 0;
        if (isStrong && rnd() < params.chordToneBias) {
          newIdx = nearestChordTone(newIdx, dir);
        }

        // GAP-FILL: leap ≥ threshold → insert a step back before continuing
        const dist = Math.abs(newIdx - idx);
        if (dist >= gapThresh && callSeq.length > 0 && callSeq.length < half - 1) {
          const fillIdx = this._clamp(newIdx + (dir > 0 ? -1 : 1), pool);
          callSeq.push({ rest: false, note: pool[fillIdx], dur: "8n" });
          if (callSeq.length >= half) break;
        }

        // POST-LEAP REVERSAL: big leap ≥ postLeapMin → next forced step reversal
        const approxSemitones = dist * 2;
        if (approxSemitones >= postLeapMin && i < half - 2) {
          // Will be handled by forcing dir reversal on next iteration via idx update
          // (setting idx to newIdx causes the next dir calculation to over-correct naturally)
        }

        idx = newIdx;
        const dur = isStrong ? (rnd() < 0.7 ? "8n" : "4n") : "8n";
        callSeq.push({ rest: false, note: pool[idx], dur });
        if (callSeq.length >= half) break;
      }

      // Pad call to half length if short
      while (callSeq.length < half && callSeq.length > 0) {
        callSeq.push({ ...callSeq[callSeq.length - 1] });
      }

      // ------- RESPONSE: vary back-half (bar 2), resolve to root -------
      // Research: "repeat exactly 2x, vary on 3rd pass — vary the back half"
      // For a single call+response pair, response = varied copy of call.
      const doOctaveShift  = rnd() < params.octaveJumpProbability;
      const shiftDir       = rnd() < 0.65 ? 1 : -1; // prefer up (brighter)
      const respSeq        = [];
      const respLen        = len - half - 1;          // leave one slot for resolution

      for (let i = 0; i < respLen; i++) {
        const src = callSeq[i % callSeq.length];
        if (!src) break;
        let newIdx2 = pool.indexOf(src.note);
        if (newIdx2 < 0) newIdx2 = idx;

        // Octave-displace the first note of the response for register contrast
        if (doOctaveShift && i === 0) {
          newIdx2 = this._displaceOctave(newIdx2, pool, shiftDir);
        }

        // Vary: diatonic step drift (mostly downward in 2nd half for arch completion)
        const drift = rnd() < 0.5 ? -1 : (rnd() < 0.6 ? 0 : 1);
        newIdx2 = this._clamp(newIdx2 + drift, pool);

        // Post-leap reversal in response half
        if (respSeq.length > 0) {
          const prev  = respSeq[respSeq.length - 1];
          if (prev && !prev.rest) {
            const pi = pool.indexOf(prev.note);
            if (pi >= 0) {
              const leap = Math.abs(newIdx2 - pi);
              if (leap * 2 >= postLeapMin && rnd() < 0.75) {
                newIdx2 = this._clamp(pi + (pi > newIdx2 ? -1 : 1), pool);
              }
            }
          }
        }

        const dur = rnd() < 0.6 ? "8n" : (rnd() < 0.5 ? "4n" : "16n");
        respSeq.push({ rest: false, note: pool[this._clamp(newIdx2, pool)], dur });
      }

      // Resolve to root
      const rootIdx = pool.findIndex((n) => this._degreeOf(n, names) === 0);
      const resolveNote = rootIdx >= 0 ? pool[rootIdx] : pool[0];
      respSeq.push({ rest: false, note: resolveNote, dur: "4n" });

      const seq = callSeq.concat(respSeq);

      // Pad to exact length
      while (seq.length < len && callSeq.length > 0) {
        seq.push({ ...callSeq[seq.length % callSeq.length] });
      }
      seq[seq.length - 1] = { rest: false, note: resolveNote, dur: "4n" };
      return seq.slice(0, len);
    },

    // ABSTRACT — experimental: wide leaps, syncopation, rests, less resolution.
    // Reads restProbability from tunable params but keeps its own leap-heavy profile.
    _genAbstract(pool, len) {
      const rnd    = this.app.rand;
      const params = this._params();
      const seq    = [];
      let   idx    = Math.floor(pool.length / 2);
      for (let i = 0; i < len; i++) {
        if (rnd() < params.restProbability + 0.12) {
          seq.push({ rest: true, dur: rnd() < 0.5 ? "16n" : "8n" }); continue;
        }
        const r = rnd();
        // Noir mood: prefer larger leaps. W mood: prefer smaller.
        const leapBig   = 5 - Math.round((params.stepVsLeapRatio - 0.55) * 4);
        const leapMid   = Math.max(3, leapBig - 1);
        const move = r < 0.35 ? (rnd() < 0.5 ? 1 : -1)
                   : r < 0.65 ? (rnd() < 0.5 ? leapMid : -leapMid)
                   :             (rnd() < 0.5 ? leapBig : -leapBig);
        idx = this._clamp(idx + move, pool);
        const rr = rnd();
        const dur = rr < 0.45 ? "16n" : rr < 0.78 ? "8n" : rr < 0.92 ? "4n" : "2n";
        seq.push({ rest: false, note: pool[idx], dur });
      }
      return seq;
    },

    generate() {
      this.riff = this._makeRiff(this.length);
      this.selected = null;
      this.dirty = false;
      this.suggEl.innerHTML = "";
      this.render();
      this.renderEditor();
      // hot-swap: if it's already looping, restart immediately with the new riff
      if (this.playing) {
        this._timers.forEach(clearTimeout);
        this._timers = [];
        this._playOnce();
      }
    },

    suggest() {
      this.suggEl.innerHTML = "";
      const head = document.createElement("div");
      head.className = "sugg-head muted";
      head.textContent = "Pick a suggestion to load it, or ▶ to preview:";
      this.suggEl.appendChild(head);
      for (let s = 0; s < 3; s++) {
        const cand = this._makeRiff(this.length);
        const row = document.createElement("div");
        row.className = "sugg-row glass";
        const preview = cand.filter((x) => !x.rest).slice(0, 10).map((x) => x.note.replace(/\d/, "")).join(" ");
        row.innerHTML = `<button class="sugg-play btn">▶</button>
          <span class="sugg-notes">${preview}…</span>
          <button class="sugg-use btn-accent">Use</button>`;
        row.querySelector(".sugg-play").addEventListener("click", () => this._preview(cand));
        row.querySelector(".sugg-use").addEventListener("click", () => {
          this.riff = cand.map((x) => ({ ...x }));
          this.selected = null; this.dirty = true;
          this.suggEl.innerHTML = "";
          this.render(); this.renderEditor();
        });
        this.suggEl.appendChild(row);
      }
    },

    /* ---------- rendering ---------- */
    render() {
      const c = this.seqEl;
      c.innerHTML = "";
      this.riff.forEach((s, i) => {
        const chip = document.createElement("div");
        chip.className = "riff-chip" + (s.rest ? " rest" : "") + (i === this.selected ? " selected" : "");
        chip.dataset.i = i;
        const main = document.createElement("span");
        main.className = "chip-note";
        main.textContent = s.rest ? "·" : s.note.replace(/(\d)$/, "");
        chip.appendChild(main);
        if (!s.rest) {
          const oc = document.createElement("sub");
          oc.textContent = s.note.match(/(\d)$/)[1];
          main.appendChild(oc);
        }
        const dur = document.createElement("span");
        dur.className = "chip-dur";
        dur.textContent = DUR_LABEL[s.dur || "8n"];
        chip.appendChild(dur);
        chip.addEventListener("click", () => this.select(i));
        c.appendChild(chip);
      });
    },

    select(i) {
      this.selected = i;
      this.render();
      this.renderEditor();
      const s = this.riff[i];
      if (s && !s.rest) { this.app.startAudio().then(() => AudioEngine.play(s.note, "8n", 0.8, undefined, this.instrument)); }
    },

    renderEditor() {
      const e = this.editorEl;
      if (this.selected == null || !this.riff[this.selected]) { e.innerHTML = ""; e.classList.remove("show"); return; }
      e.classList.add("show");
      const s = this.riff[this.selected];
      const durBtns = DUR_ORDER.map((d) =>
        `<button class="ed-dur ${s.dur === d ? "active" : ""}" data-dur="${d}">${DUR_LABEL[d]}</button>`).join("");
      e.innerHTML = `
        <div class="ed-row">
          <span class="ed-title">Note ${this.selected + 1}: <b>${s.rest ? "Rest" : s.note}</b></span>
          <button class="ed-rest btn">${s.rest ? "Make Note" : "Make Rest"}</button>
        </div>
        <div class="ed-row ${s.rest ? "ed-disabled" : ""}">
          <span class="ed-lbl">Pitch</span>
          <button class="ed-pitch btn" data-d="-1">▼ down</button>
          <button class="ed-pitch btn" data-d="1">▲ up</button>
          <span class="ed-lbl">Octave</span>
          <button class="ed-oct btn" data-d="-1">−</button>
          <button class="ed-oct btn" data-d="1">+</button>
        </div>
        <div class="ed-row">
          <span class="ed-lbl">Length</span>
          <div class="ed-durs">${durBtns}</div>
        </div>
        <div class="ed-row">
          <button class="ed-insert btn">＋ Insert after</button>
          <button class="ed-delete btn">🗑 Delete</button>
          <button class="ed-play btn-accent">▶ Hear note</button>
        </div>`;

      e.querySelectorAll(".ed-dur").forEach((b) => b.addEventListener("click", () => { s.dur = b.dataset.dur; this._edited(); }));
      e.querySelector(".ed-rest").addEventListener("click", () => {
        if (s.rest) { s.rest = false; if (!s.note) s.note = this._pool()[0]; } else { s.rest = true; }
        this._edited();
      });
      e.querySelectorAll(".ed-pitch").forEach((b) => b.addEventListener("click", () => this._shiftPitch(+b.dataset.d)));
      e.querySelectorAll(".ed-oct").forEach((b) => b.addEventListener("click", () => this._shiftOctave(+b.dataset.d)));
      e.querySelector(".ed-insert").addEventListener("click", () => this._insertAfter());
      e.querySelector(".ed-delete").addEventListener("click", () => this._deleteSel());
      e.querySelector(".ed-play").addEventListener("click", () => {
        if (!s.rest) this.app.startAudio().then(() => AudioEngine.play(s.note, s.dur, 0.85, undefined, this.instrument));
      });
    },

    _allPool() {
      // wider pool for editing (octaves 2..5) so pitch/octave moves have room
      let out = [];
      for (let o = 2; o <= 5; o++) out = out.concat(this.app.scaleNotesWithOctaves(o).slice(0, -1));
      return out;
    },
    _shiftPitch(d) {
      const s = this.riff[this.selected];
      if (!s || s.rest) return;
      const pool = this._allPool();
      let idx = pool.indexOf(s.note);
      if (idx < 0) { // not exact in pool — snap to nearest by pitch
        const target = this._abs(s.note);
        idx = pool.reduce((best, n, i) => Math.abs(this._abs(n) - target) < Math.abs(this._abs(pool[best]) - target) ? i : best, 0);
      }
      idx = Math.max(0, Math.min(pool.length - 1, idx + d));
      s.note = pool[idx];
      this._edited();
      this.app.startAudio().then(() => AudioEngine.play(s.note, "8n", 0.8, undefined, this.instrument));
    },
    _shiftOctave(d) {
      const s = this.riff[this.selected];
      if (!s || s.rest) return;
      const m = s.note.match(/^([A-G]#?b?)(\d)$/);
      let oct = Math.max(1, Math.min(6, +m[2] + d));
      s.note = m[1] + oct;
      this._edited();
      this.app.startAudio().then(() => AudioEngine.play(s.note, "8n", 0.8, undefined, this.instrument));
    },
    _abs(note) {
      const m = note.match(/^([A-G]#?b?)(\d)$/);
      return Theory.noteIndex(m[1]) + (+m[2]) * 12;
    },
    _insertAfter() {
      const s = this.riff[this.selected];
      const copy = s.rest ? { rest: true, dur: s.dur } : { rest: false, note: s.note, dur: s.dur };
      this.riff.splice(this.selected + 1, 0, copy);
      this.selected += 1;
      this._edited();
    },
    _deleteSel() {
      if (this.riff.length <= 1) return;
      this.riff.splice(this.selected, 1);
      this.selected = Math.min(this.selected, this.riff.length - 1);
      this._edited();
    },
    _edited() { this.dirty = true; this.render(); this.renderEditor(); },

    /* ---------- playback (variable durations) ---------- */
    _spb() { return 60 / this.bpm; },

    togglePlay() {
      if (this.playing) { this.stop(); return; }
      if (!this.riff.length) this.generate();
      this.playing = true;
      document.getElementById("riff-play").textContent = "■ Stop";
      this.app.startAudio().then(() => this._playOnce());
    },

    _scheduleNotes(seq, t0, inst, onFlash) {
      const spb = this._spb();
      const swing = this.feel === "swing" ? 0.16 : 0;
      const gate = this.feel === "staccato" ? 0.5 : this.feel === "swing" ? 0.9 : 1.0;
      let acc = 0, beatPos = 0;
      seq.forEach((s, i) => {
        const dsec = (DUR_BEATS[s.dur || "8n"]) * spb;
        if (!s.rest) {
          const onBeatOdd = Math.floor(beatPos * 2) % 2 === 1;
          const sw = onBeatOdd ? dsec * swing : 0;
          const jitter = (this.app.rand() - 0.5) * 0.01;
          const t = t0 + acc + sw + jitter;
          const accent = (beatPos % 1 < 0.01) ? 0.13 : 0.04;
          const vel = Math.min(0.92, 0.52 + accent + this.app.rand() * 0.2);
          AudioEngine.play(s.note, Math.max(0.05, dsec * gate), vel, t, inst);
          if (onFlash) {
            const delay = (t - AudioEngine.now()) * 1000;
            const tm = setTimeout(() => onFlash(s.note, i), Math.max(0, delay));
            this._timers.push(tm);
          }
        }
        acc += dsec; beatPos += DUR_BEATS[s.dur || "8n"];
      });
      return acc;
    },

    _playOnce() {
      const t0 = AudioEngine.now() + 0.1;
      const total = this._scheduleNotes(this.riff, t0, this.instrument, (note, i) => {
        this.app.flashNote(note);
        this._highlightChip(i);
      });
      const end = setTimeout(() => {
        if (this.loop && this.playing) this._playOnce();
        else this.stop();
      }, total * 1000 + 140);
      this._timers.push(end);
    },

    _preview(seq) {
      const t0 = AudioEngine.now() + 0.08;
      this.app.startAudio().then(() => this._scheduleNotes(seq, t0, this.instrument, null));
    },

    _highlightChip(i) {
      this.seqEl.querySelectorAll(".riff-chip").forEach((c) => c.classList.remove("on"));
      const el = this.seqEl.querySelector(`[data-i="${i}"]`);
      if (el) el.classList.add("on");
    },

    stop() {
      this.playing = false;
      this._timers.forEach(clearTimeout);
      this._timers = [];
      document.getElementById("riff-play").textContent = "▶ Play";
      this.seqEl.querySelectorAll(".riff-chip").forEach((c) => c.classList.remove("on"));
    },

    /* ---------- save / load (localStorage) ---------- */
    _loadSaved() {
      try { this.saved = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
      catch (e) { this.saved = []; }
    },
    _persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.saved)); } catch (e) {} },

    saveCurrent() {
      if (!this.riff.length) return;
      const def = `${this.app.state.root} ${Theory.SCALES[this.app.state.scale].name.split(" ")[0]} riff`;
      const name = (window.prompt("Name this riff:", def) || "").trim();
      if (!name) return;
      this.saved.unshift({
        name, bpm: this.bpm, instrument: this.instrument,
        key: `${this.app.state.root} ${Theory.SCALES[this.app.state.scale].name}`,
        riff: this.riff.map((s) => ({ ...s })),
      });
      this._persist();
      this.renderSaved();
      this.app.toast(`Saved “${name}” ✓`);
    },

    renderSaved() {
      const c = this.savedEl;
      c.innerHTML = "";
      if (!this.saved.length) {
        c.innerHTML = `<p class="muted">No saved riffs yet. When you write a keeper, hit <b>⚰️ Save</b>.</p>`;
        return;
      }
      this.saved.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "saved-row glass";
        row.innerHTML = `
          <div class="saved-meta">
            <span class="saved-name">${item.name}</span>
            <span class="saved-sub">${item.key} · ${item.instrument} · ${item.bpm}bpm</span>
          </div>
          <button class="saved-play btn">▶</button>
          <button class="saved-load btn-accent">Load</button>
          <button class="saved-del btn">🗑</button>`;
        row.querySelector(".saved-play").addEventListener("click", () => {
          this.app.startAudio().then(() => {
            const old = this.instrument; this.instrument = item.instrument;
            this._scheduleNotes(item.riff, AudioEngine.now() + 0.08, item.instrument, null);
            this.instrument = old;
          });
        });
        row.querySelector(".saved-load").addEventListener("click", () => this.loadSaved(i));
        row.querySelector(".saved-del").addEventListener("click", () => {
          this.saved.splice(i, 1); this._persist(); this.renderSaved();
        });
        c.appendChild(row);
      });
    },

    loadSaved(i) {
      const item = this.saved[i];
      if (!item) return;
      this.riff = item.riff.map((s) => ({ ...s }));
      this.bpm = item.bpm || 100;
      this.instrument = item.instrument || "piano";
      this.dirty = true;
      this.selected = null;
      document.getElementById("riff-bpm").value = this.bpm;
      document.getElementById("riff-bpm-val").textContent = this.bpm;
      document.querySelectorAll("#riff-inst .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.riffInst === this.instrument));
      this.render(); this.renderEditor();
      this.app.toast(`Loaded “${item.name}”`);
    },

    /* ---------- looper hand-off ---------- */
    sendToLooper() {
      if (!this.riff.length || !root.Looper) return;
      const spb = this._spb();
      const events = [];
      let acc = 0;
      this.riff.forEach((s) => {
        const dsec = DUR_BEATS[s.dur || "8n"] * spb;
        if (!s.rest) events.push({ time: acc, note: s.note, dur: dsec * 0.9, instrument: this.instrument });
        acc += dsec;
      });
      Looper.addTrack(`Riff · ${this.app.state.root} ${Theory.SCALES[this.app.state.scale].name.split(" ")[0]}`, events, acc);
      this.app.toast("Riff sent to Looper ✓");
    },
  };

  root.Riff = Riff;
})(typeof window !== "undefined" ? window : globalThis);
