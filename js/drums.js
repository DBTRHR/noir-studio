/* =====================================================================
   NOIR Studio — Drum Engine (Tone.js)
   Two kits behind one API:
     • electronic — fully synthesized (MembraneSynth / NoiseSynth /
                    MetalSynth). Zero network, always available.
     • acoustic   — sampled drums lazy-loaded from a free CDN
                    (nbrosowsky/tonejs-instruments "drum-samples", served
                    via jsDelivr). If a sample/CDN fails, the voice falls
                    back to its electronic counterpart — mirroring the rest
                    of the app's synth-fallback philosophy.

   Voices: kick, snare, closedHat, openHat, clap, tomLow, tomHigh,
           crash, ride.

   API (all guarded — no AudioContext nodes are created until
   AudioEngine.start() has run, i.e. until ensure() is called):
     Drums.ensure()                       — lazily build the electronic kit
     Drums.setKit('electronic'|'acoustic')— switch active kit (lazy-loads
                                             acoustic samples on first use)
     Drums.trigger(voice, time, vel, kit) — sample-accurate hit at absolute
                                             transport time `time`
     Drums.VOICES                         — ordered voice metadata for UIs
     Drums.isDrumInstrument(id)           — 'edrums' | 'adrums' => true
     Drums.kitFor(instrumentId)           — map track instrument -> kit name

   The looper schedules drum hits inside Tone.Sequence callbacks and passes
   the callback's absolute `time`, so everything stays sample-accurate.
   ===================================================================== */
(function (root) {
  "use strict";

  // Ordered voice list — rows of the step sequencer render in this order.
  const VOICES = [
    { id: "kick",      label: "Kick",       short: "Kick" },
    { id: "snare",     label: "Snare",      short: "Snr"  },
    { id: "closedHat", label: "Closed Hat", short: "CH"   },
    { id: "openHat",   label: "Open Hat",   short: "OH"   },
    { id: "clap",      label: "Clap",       short: "Clap" },
    { id: "tomLow",    label: "Low Tom",    short: "LoT"  },
    { id: "tomHigh",   label: "High Tom",   short: "HiT"  },
    { id: "crash",     label: "Crash",      short: "Cr"   },
    { id: "ride",      label: "Ride",       short: "Rd"   },
  ];

  // Acoustic sample set. nbrosowsky/tonejs-instruments ships a "drum-samples"
  // folder with named one-shots. We self-route through jsDelivr CDN. Each entry
  // maps a voice -> a single sample file (one-shot, triggered with a fixed
  // pitch). If a file 404s or the CDN is blocked, that voice falls back to the
  // electronic synth voice of the same name.
  const ACOUSTIC_CDN =
    "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/";
  // Map each voice to [folder, filename, noteForSampler].
  // These folders/files exist in the tonejs-instruments "casio"/"drum" style
  // packs; if a given one is missing the per-voice loader simply falls back.
  const ACOUSTIC_FILES = {
    kick:      ["drum-samples/CR78/", "Kick.mp3"],
    snare:     ["drum-samples/CR78/", "Snare.mp3"],
    closedHat: ["drum-samples/CR78/", "HiHat.mp3"],
    openHat:   ["drum-samples/CR78/", "HiHatOpen.mp3"],
    clap:      ["drum-samples/CR78/", "Clap.mp3"],
    tomLow:    ["drum-samples/CR78/", "Tom2.mp3"],
    tomHigh:   ["drum-samples/CR78/", "Tom1.mp3"],
    crash:     ["drum-samples/CR78/", "Crash.mp3"],
    ride:      ["drum-samples/CR78/", "Ride.mp3"],
  };

  const Drums = {
    VOICES,
    ready: false,           // electronic kit built
    _kit: "electronic",     // active kit
    _bus: null,             // shared output bus -> AudioEngine chain / dest
    _e: null,               // electronic voices { voice: {trigger(time,vel)} }
    _a: null,               // acoustic Tone.Sampler map { voice: sampler|null }
    _acousticState: "idle", // 'idle' | 'loading' | 'ready'

    isDrumInstrument(id) { return id === "edrums" || id === "adrums"; },
    kitFor(id) { return id === "adrums" ? "acoustic" : "electronic"; },

    // Build the electronic kit. Safe to call repeatedly; no-op once ready.
    // Guard: requires Tone + a started AudioContext (AudioEngine.start()).
    ensure() {
      if (this.ready) return;
      if (!root.Tone) return;

      // Route drums through the master AudioEngine chain if available so they
      // share reverb/EQ/limiter; otherwise straight to destination.
      const dest =
        (root.AudioEngine && (root.AudioEngine._delay || root.AudioEngine._reverb)) ||
        Tone.getDestination();
      this._bus = new Tone.Gain(1).connect(dest);

      this._e = this._buildElectronic(this._bus);
      this.ready = true;
    },

    /* ------------------------------------------------------------------ */
    /*  Electronic kit — pure synthesis                                    */
    /* ------------------------------------------------------------------ */
    _buildElectronic(out) {
      const T = root.Tone;

      // KICK — punchy membrane with fast pitch sweep.
      const kick = new T.MembraneSynth({
        pitchDecay: 0.045, octaves: 7, volume: 2,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.2, attackCurve: "exponential" },
      }).connect(out);

      // SNARE — bright noise burst + a short tonal body.
      const snareNoise = new T.NoiseSynth({
        volume: -6, noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
      });
      const snareHP = new T.Filter({ type: "highpass", frequency: 1200, rolloff: -12 });
      snareNoise.connect(snareHP); snareHP.connect(out);
      const snareBody = new T.MembraneSynth({
        pitchDecay: 0.02, octaves: 3, volume: -10,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
      }).connect(out);

      // CLOSED HAT — short metallic burst.
      const closedHat = new T.MetalSynth({
        volume: -16, frequency: 250, harmonicity: 5.1, modulationIndex: 32,
        resonance: 5000, octaves: 1.4,
        envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      });
      const chHP = new T.Filter({ type: "highpass", frequency: 6000, rolloff: -12 });
      closedHat.connect(chHP); chHP.connect(out);

      // OPEN HAT — same engine, longer decay.
      const openHat = new T.MetalSynth({
        volume: -18, frequency: 250, harmonicity: 5.1, modulationIndex: 32,
        resonance: 4200, octaves: 1.6,
        envelope: { attack: 0.001, decay: 0.4, release: 0.12 },
      });
      const ohHP = new T.Filter({ type: "highpass", frequency: 5200, rolloff: -12 });
      openHat.connect(ohHP); ohHP.connect(out);

      // CLAP — layered noise bursts (a couple of fast retriggers).
      const clap = new T.NoiseSynth({
        volume: -8, noise: { type: "pink" },
        envelope: { attack: 0.001, decay: 0.13, sustain: 0 },
      });
      const clapBP = new T.Filter({ type: "bandpass", frequency: 1500, Q: 1.2 });
      clap.connect(clapBP); clapBP.connect(out);

      // TOMS — tuned membranes.
      const tomLow = new T.MembraneSynth({
        pitchDecay: 0.06, octaves: 5, volume: -4,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.6 },
      }).connect(out);
      const tomHigh = new T.MembraneSynth({
        pitchDecay: 0.05, octaves: 5, volume: -4,
        envelope: { attack: 0.001, decay: 0.24, sustain: 0.01, release: 0.5 },
      }).connect(out);

      // CRASH / RIDE — long metallic cymbals.
      const crash = new T.MetalSynth({
        volume: -22, frequency: 300, harmonicity: 5.1, modulationIndex: 40,
        resonance: 4000, octaves: 2,
        envelope: { attack: 0.001, decay: 1.4, release: 0.6 },
      });
      const crashHP = new T.Filter({ type: "highpass", frequency: 3500, rolloff: -12 });
      crash.connect(crashHP); crashHP.connect(out);

      const ride = new T.MetalSynth({
        volume: -24, frequency: 480, harmonicity: 3.4, modulationIndex: 22,
        resonance: 6000, octaves: 1.6,
        envelope: { attack: 0.001, decay: 0.9, release: 0.4 },
      });
      const rideHP = new T.Filter({ type: "highpass", frequency: 4500, rolloff: -12 });
      ride.connect(rideHP); rideHP.connect(out);

      // Each entry: trigger(time, vel) — time is absolute transport seconds.
      return {
        kick:      { trigger: (t, v) => kick.triggerAttackRelease("C1", "8n", t, v) },
        snare:     { trigger: (t, v) => { snareNoise.triggerAttackRelease("16n", t, v); snareBody.triggerAttackRelease("G2", "16n", t, v * 0.8); } },
        closedHat: { trigger: (t, v) => closedHat.triggerAttackRelease("32n", t, v * 0.7) },
        openHat:   { trigger: (t, v) => openHat.triggerAttackRelease("8n", t, v * 0.7) },
        clap:      { trigger: (t, v) => { clap.triggerAttackRelease("16n", t, v); clap.triggerAttackRelease("16n", t + 0.01, v * 0.6); } },
        tomLow:    { trigger: (t, v) => tomLow.triggerAttackRelease("A1", "8n", t, v) },
        tomHigh:   { trigger: (t, v) => tomHigh.triggerAttackRelease("E2", "8n", t, v) },
        crash:     { trigger: (t, v) => crash.triggerAttackRelease("2n", t, v * 0.8) },
        ride:      { trigger: (t, v) => ride.triggerAttackRelease("4n", t, v * 0.8) },
        _nodes: [kick, snareNoise, snareHP, snareBody, closedHat, chHP, openHat,
                 ohHP, clap, clapBP, tomLow, tomHigh, crash, crashHP, ride, rideHP],
      };
    },

    /* ------------------------------------------------------------------ */
    /*  Acoustic kit — lazy-loaded samples, per-voice fallback             */
    /* ------------------------------------------------------------------ */
    _loadAcoustic() {
      if (this._acousticState !== "idle") return;
      if (!root.Tone || !this._bus) return;
      this._acousticState = "loading";
      this._a = {};

      VOICES.forEach((v) => {
        const spec = ACOUSTIC_FILES[v.id];
        if (!spec) { this._a[v.id] = null; return; }
        const [folder, file] = spec;
        let settled = false;
        const sampler = new Tone.Sampler({
          urls: { C3: file },
          baseUrl: ACOUSTIC_CDN + folder,
          onload: () => { settled = true; },
          onerror: () => {
            if (settled) return; settled = true;
            try { sampler.dispose(); } catch (e) {}
            this._a[v.id] = null;   // -> falls back to electronic
          },
        }).connect(this._bus);
        // Safety timeout: if neither callback fires, drop to fallback.
        setTimeout(() => {
          if (settled) return; settled = true;
          if (this._a[v.id] && !this._a[v.id].loaded) this._a[v.id] = null;
        }, 9000);
        this._a[v.id] = sampler;
      });
      this._acousticState = "ready";
    },

    /* ------------------------------------------------------------------ */
    /*  Kit selection                                                      */
    /* ------------------------------------------------------------------ */
    setKit(kit) {
      this._kit = kit === "acoustic" ? "acoustic" : "electronic";
      if (this._kit === "acoustic") { this.ensure(); this._loadAcoustic(); }
    },

    /* ------------------------------------------------------------------ */
    /*  Trigger a voice at an absolute time                                */
    /*  `kit` overrides the active kit (so a track can specify its own).   */
    /* ------------------------------------------------------------------ */
    trigger(voice, time, velocity, kit) {
      this.ensure();
      if (!this.ready) return;
      const vel = velocity == null ? 0.9 : Math.max(0, Math.min(1, velocity));
      const useKit = kit || this._kit;

      if (useKit === "acoustic") {
        if (this._acousticState === "idle") this._loadAcoustic();
        const s = this._a && this._a[voice];
        if (s && s.loaded) {
          try { s.triggerAttackRelease("C3", "1n", time, vel); return; } catch (e) {}
        }
        // not loaded / failed -> electronic fallback
      }

      const e = this._e && this._e[voice];
      if (e) { try { e.trigger(time, vel); } catch (err) {} }
    },

    /* ------------------------------------------------------------------ */
    /*  Genre groove presets (NEW)                                         */
    /*  Returns a 16-step pattern object for the requested genre.          */
    /*  Delegates to Theory.getGroovePreset so patterns live in one place. */
    /*  genre: "rock"|"funk"|"metal"|"hiphop"|"neo-soul"|"blues"|"bossa"  */
    /*                                                                     */
    /*  Each key (kick/snare/closedHat/openHat) maps to a 16-element      */
    /*  boolean array: true = hit on that 16th-note step.                  */
    /* ------------------------------------------------------------------ */
    getGroovePreset(genre) {
      if (root.Theory && Theory.getGroovePreset) return Theory.getGroovePreset(genre);
      // fallback minimal rock beat if Theory isn't loaded yet
      return {
        kick:      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        closedHat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      };
    },

    /* Returns array of groove genre names. */
    groovePresetNames() {
      if (root.Theory && Theory.groovePresetNames) return Theory.groovePresetNames();
      return ["rock","funk","metal","hiphop","neo-soul","blues","bossa"];
    },
  };

  root.Drums = Drums;
})(typeof window !== "undefined" ? window : globalThis);
