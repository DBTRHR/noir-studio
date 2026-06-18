/* =====================================================================
   NOIR Studio — Audio Engine (Tone.js + real recorded samples)
   Piano  : Salamander Grand Piano  (tonejs.github.io/audio/salamander)
   Guitar : nbrosowsky/tonejs-instruments (acoustic + electric) via jsDelivr
   Falls back to a warm synth if samples fail to load (offline-safe).
   ===================================================================== */
(function (root) {
  "use strict";

  // Guitar samples are self-hosted (downloaded into ./samples/) so they load
  // reliably and work offline. Piano stays on the Salamander CDN (works well).
  const GH = "samples/";

  const SAMPLE_MAPS = {
    piano: {
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
        A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
        A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
        A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
        A7: "A7.mp3", C8: "C8.mp3",
      },
    },
    acoustic: {
      baseUrl: GH + "guitar-acoustic/",
      urls: {
        D2: "D2.mp3", E2: "E2.mp3", F2: "F2.mp3", "F#2": "Fs2.mp3",
        G2: "G2.mp3", "G#2": "Gs2.mp3", A2: "A2.mp3", "A#2": "As2.mp3", B2: "B2.mp3",
        C3: "C3.mp3", "C#3": "Cs3.mp3", D3: "D3.mp3", E3: "E3.mp3",
        "F#3": "Fs3.mp3", G3: "G3.mp3", "G#3": "Gs3.mp3", A3: "A3.mp3",
        "A#3": "As3.mp3", B3: "B3.mp3", C4: "C4.mp3", "C#4": "Cs4.mp3",
        D4: "D4.mp3", E4: "E4.mp3", "F#4": "Fs4.mp3", G4: "G4.mp3",
        "G#4": "Gs4.mp3", A4: "A4.mp3", "A#4": "As4.mp3", C5: "C5.mp3",
      },
    },
    electric: {
      baseUrl: GH + "guitar-electric/",
      urls: {
        E2: "E2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3", "C#2": "Cs2.mp3",
        C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
        C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
        C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
        C6: "C6.mp3",
      },
    },
  };

  const AudioEngine = {
    ready: false,
    started: false,
    _instruments: {},      // name -> Tone.Sampler | Tone.PolySynth
    _current: "piano",
    _reverb: null,
    _limiter: null,
    _volume: null,
    onProgress: null,      // (fraction 0..1, label) callback

    async start() {
      if (this.started) return;
      if (root.Tone) { await Tone.start(); this.started = true; }
    },

    async init() {
      if (this.ready) return;
      if (!root.Tone) { console.warn("Tone.js not loaded"); return; }

      // Master chain: [instruments] -> reverb -> warmth EQ -> glue comp -> vol -> limiter -> out
      this._limiter = new Tone.Limiter(-1).toDestination();
      this._volume  = new Tone.Volume(-9).connect(this._limiter);
      this._comp    = new Tone.Compressor({ threshold: -22, ratio: 2.4, attack: 0.012, release: 0.18 }).connect(this._volume);
      // gentle warmth: lift lows a touch, tame harsh highs
      this._eq      = new Tone.EQ3({ low: 1.5, mid: 0, high: -2.5, lowFrequency: 250, highFrequency: 3500 }).connect(this._comp);
      this._reverb  = new Tone.Reverb({ decay: 2.6, preDelay: 0.02, wet: 0.13 }).connect(this._eq);
      // delay insert (off by default) — instruments feed this, it feeds reverb
      this._delay   = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.3, wet: 0, maxDelay: 1.5 }).connect(this._reverb);

      const names = Object.keys(SAMPLE_MAPS);
      let loaded = 0;
      const total = names.length;

      await Promise.all(names.map((name) => new Promise((resolve) => {
        let settled = false;
        const done = (instrument) => {
          if (settled) return;
          settled = true;
          this._instruments[name] = instrument;
          loaded++;
          if (this.onProgress) this.onProgress(loaded / total, name);
          resolve();
        };
        try {
          const map = SAMPLE_MAPS[name];
          const sampler = new Tone.Sampler({
            urls: map.urls,
            baseUrl: map.baseUrl,
            release: 1,
            onload: () => done(sampler),
            onerror: () => { try { sampler.dispose(); } catch (e) {} done(this._fallbackSynth(name)); },
          }).connect(this._delay);
          // Safety timeout in case onload/onerror never fires (CDN blocked)
          setTimeout(() => { if (!settled) done(this._fallbackSynth(name)); }, 9000);
        } catch (e) {
          done(this._fallbackSynth(name));
        }
      })));

      this.ready = true;
    },

    _fallbackSynth(name) {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: name === "piano" ? "triangle" : "fmsine" },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 1.2 },
      }).connect(this._reverb || Tone.getDestination());
      synth._isFallback = true;
      return synth;
    },

    usingFallback(name) {
      const inst = this._instruments[name || this._current];
      return !!(inst && inst._isFallback);
    },

    setInstrument(name) {
      if (this._instruments[name]) this._current = name;
    },
    getInstrumentName() { return this._current; },

    setVolume(db) { if (this._volume) this._volume.volume.rampTo(db, 0.1); },
    setReverb(wet) { if (this._reverb) this._reverb.wet.rampTo(wet, 0.1); },

    // Guitar/riff delay presets
    _DELAY: {
      off:      { time: "8n",  fb: 0.0,  wet: 0.0 },
      slapback: { time: 0.09,  fb: 0.15, wet: 0.32 },
      echo:     { time: "8n",  fb: 0.34, wet: 0.34 },
      dotted:   { time: "8n.", fb: 0.40, wet: 0.38 },
      ambient:  { time: "4n",  fb: 0.55, wet: 0.42 },
    },
    setDelay(preset) {
      if (!this._delay) return;
      const p = this._DELAY[preset] || this._DELAY.off;
      try {
        const secs = typeof p.time === "number" ? p.time : Tone.Time(p.time).toSeconds();
        this._delay.delayTime.rampTo(secs, 0.05);
        this._delay.feedback.rampTo(p.fb, 0.05);
        this._delay.wet.rampTo(p.wet, 0.08);
      } catch (e) {}
    },

    _inst(name) { return this._instruments[name || this._current]; },
    now() { return root.Tone ? Tone.now() : 0; },

    play(note, dur = "8n", velocity = 0.85, time, instrument) {
      const inst = this._inst(instrument);
      if (!inst) return;
      try { inst.triggerAttackRelease(note, dur, time, velocity); } catch (e) {}
    },
    attack(note, velocity = 0.85, instrument) {
      const inst = this._inst(instrument);
      if (!inst) return;
      try { inst.triggerAttack(note, undefined, velocity); } catch (e) {}
    },
    release(note, instrument) {
      const inst = this._inst(instrument);
      if (!inst) return;
      try { inst.triggerRelease(note); } catch (e) {}
    },
    // Strum a chord (array of notes with octaves), slight humanized offset
    strum(notes, dur = "2n", velocity = 0.8, instrument) {
      const t = this.now();
      notes.forEach((n, i) => this.play(n, dur, velocity, t + i * 0.025, instrument));
    },
  };

  root.AudioEngine = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
