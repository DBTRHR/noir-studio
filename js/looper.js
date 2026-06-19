/* =====================================================================
   NOIR Studio — Studio (multitrack recorder)
   FL-Studio-style multitrack: up to 12 tracks, per-track record-arm,
   solo / mute / volume, overdub recording, transport + metronome with
   a 1-bar count-in and a fixed quantize grid locked to loop start.

   Built on Tone.Transport + Tone.Part for sample-accurate loops.

   Backward compatible: the global is still `window.Looper`, and
   `Looper.addTrack(name, events, loopLen)` still works for Spark / Riff /
   Nathan hand-offs (events: [{ time, note, dur, instrument }]).

   ── HOOKS FOR LATER STAGES (leave intact) ───────────────────────────
   • DRUM ENGINE        — see INSTRUMENTS[] (drum options present, routed
                          through AudioEngine.play; swap in a drum sampler
                          later). Track model already carries `instrument`.
   • STEP SEQUENCER     — see `Looper.openStepSequencer(trackId)` stub.
   • ARRANGEMENT CANVAS — see `Looper.renderArrangement()` stub + the
                          `#studio-arrange` mount point in index.html.
   • UNDO / REDO        — see `Looper._snapshot()` / `_history` stub and the
                          Backspace/Home/Insert/Pause reserved hotkeys.
   • COPY / PASTE       — clipboard stub `Looper._clipboard`.
   ===================================================================== */
(function (root) {
  "use strict";

  const COLORS = ["#e10600", "#ff5252", "#ff8f00", "#00e5ff", "#7c4dff",
                  "#00e676", "#ff4081", "#ffd740", "#40c4ff", "#b388ff",
                  "#69f0ae", "#ff6e40"];

  // Instrument options offered in each track's picker. The drum entries are
  // driven by the Drums engine (js/drums.js): a drum track plays a step
  // pattern (track.steps) via a Tone.Sequence rather than recorded note
  // events. `edrums` uses the synthesized electronic kit; `adrums` lazy-loads
  // sampled acoustic drums (falling back to electronic if the CDN is blocked).
  const INSTRUMENTS = [
    { id: "piano",    label: "Piano" },
    { id: "acoustic", label: "Acoustic Guitar" },
    { id: "electric", label: "Electric Guitar" },
    { id: "edrums",   label: "Electronic Drums" },
    { id: "adrums",   label: "Acoustic Drums" },
  ];

  // Drum-engine helpers (with safe fallbacks if drums.js failed to load).
  const isDrum = (id) =>
    (root.Drums && root.Drums.isDrumInstrument)
      ? root.Drums.isDrumInstrument(id)
      : (id === "edrums" || id === "adrums");
  const kitFor = (id) =>
    (root.Drums && root.Drums.kitFor) ? root.Drums.kitFor(id)
      : (id === "adrums" ? "acoustic" : "electronic");
  const DRUM_VOICES = () =>
    (root.Drums && root.Drums.VOICES) ? root.Drums.VOICES
      : [{ id: "kick", label: "Kick", short: "Kick" },
         { id: "snare", label: "Snare", short: "Snr" },
         { id: "closedHat", label: "Closed Hat", short: "CH" },
         { id: "openHat", label: "Open Hat", short: "OH" },
         { id: "clap", label: "Clap", short: "Clap" }];

  const STEPS_PER_BAR = 16; // 16th-note grid

  const MAX_TRACKS = 12;

  const Looper = {
    app: null,

    // tracks: [{ id, name, instrument, events:[{time,note,dur,instrument,vel}],
    //            armed, muted, soloed, volume, color, part }]
    tracks: [],
    recording: false,
    playing: false,
    countingIn: false,
    bpm: 100,
    bars: 2,
    quantize: true,
    metronome: false,

    _nextId: 1,
    _metroLoop: null,
    _metroSynth: null,
    _countLoop: null,       // count-in metronome (always clicks during count-in)
    _recStartId: null,      // Tone.Transport schedule id for record start

    seqTrackId: null,       // track whose step grid is currently open (or null)

    // ── undo / redo ──
    _history: [],           // stack of JSON snapshots (state BEFORE each edit)
    _redo: [],              // redo stack (snapshots popped from history)
    _HISTORY_MAX: 100,
    _restoring: false,      // guard: don't snapshot while restoring

    // ── copy / paste ──
    // _clipboard: { kind:'tracks', tracks:[serializedTrack,...] }
    //          or { kind:'clips',  clips:[serializedClip,...] }
    _clipboard: null,

    // ── selection model ──
    // selection of mixer tracks (Loop mode) by id, and arrangement clips by clip id
    _selTracks: [],         // array of track ids
    _selClips: [],          // array of clip ids

    // ── Loop ⇄ Song ──
    mode: "loop",           // "loop" | "song"
    songLen: 30,            // seconds — auto-sizing canvas length (starts ~30s)
    SONG_MIN: 30,
    SONG_MAX: 480,          // hard cap 8:00
    // arrangement clips placed on the timeline:
    // { id, trackId, start (sec), len (sec), kind:'loop'|'drum',
    //   events:[...], steps:{...}, instrument, color, name }
    clips: [],
    _nextClipId: 1,
    _songPlaying: false,
    _songParts: [],         // active Tone nodes for song playback (disposed on stop)
    _songStopId: null,

    /* ============================================================= */
    /*  Geometry / timing helpers                                    */
    /* ============================================================= */
    secPerBeat() { return 60 / this.bpm; },             // 4/4 quarter note
    secPerBar() { return this.secPerBeat() * 4; },
    loopLength() { return this.bars * this.secPerBar(); }, // seconds

    // The quantize grid: 16th notes (4 per beat), aligned to loopStart (0).
    // The metronome clicks on quarter-notes, which are an exact multiple of
    // this grid, so quantized notes always coincide with a metronome click
    // (when they land on a beat) or sit cleanly on the sub-beat grid between.
    gridStep() { return this.secPerBeat() / 4; },       // 16th-note grid

    // Snap a loop-relative time (seconds) onto the grid, wrapping at loop end.
    _snap(t) {
      const L = this.loopLength();
      const g = this.gridStep();
      let s = Math.round(t / g) * g;
      // wrap a tick landing exactly on loop end back to the downbeat
      if (s >= L - 1e-6) s = 0;
      if (s < 0) s = 0;
      return s;
    },

    /* ============================================================= */
    /*  Mount / DOM wiring                                            */
    /* ============================================================= */
    mount(app) {
      this.app = app;

      // Studio page elements
      this.listEl   = document.getElementById("studio-tracks");
      this.recBtn   = document.getElementById("studio-rec");
      this.playBtn  = document.getElementById("studio-play");
      this.addBtn   = document.getElementById("studio-add");
      this.posEl    = document.getElementById("studio-pos");
      this.seqEl    = document.getElementById("studio-seq");       // step-sequencer mount
      this.arrangeEl = document.getElementById("studio-arrange"); // arrangement canvas mount (later)

      // Slim floating transport (visible on Piano/Guitar/Riff so you can
      // record while playing those boards).
      this.stripRec  = document.getElementById("xport-rec");
      this.stripPlay = document.getElementById("xport-play");
      this.stripPos  = document.getElementById("xport-pos");

      if (this.recBtn)  this.recBtn.addEventListener("click", () => this.toggleRecord());
      if (this.playBtn) this.playBtn.addEventListener("click", () => this.togglePlay());
      if (this.addBtn)  this.addBtn.addEventListener("click", () => this.addEmptyTrack());

      const clearBtn = document.getElementById("studio-clear");
      if (clearBtn) clearBtn.addEventListener("click", () => this.clearAll());

      // edit toolbar
      const undoBtn = document.getElementById("studio-undo");
      if (undoBtn) undoBtn.addEventListener("click", () => this.undo());
      const redoBtn = document.getElementById("studio-redo");
      if (redoBtn) redoBtn.addEventListener("click", () => this.redo());
      const copyBtn = document.getElementById("studio-copy");
      if (copyBtn) copyBtn.addEventListener("click", () => this.copySelection());
      const pasteBtn = document.getElementById("studio-paste");
      if (pasteBtn) pasteBtn.addEventListener("click", () => this.pasteClipboard());

      // mode toggle
      const modeLoop = document.getElementById("studio-mode-loop");
      if (modeLoop) modeLoop.addEventListener("click", () => this.setMode("loop"));
      const modeSong = document.getElementById("studio-mode-song");
      if (modeSong) modeSong.addEventListener("click", () => this.setMode("song"));

      if (this.stripRec)  this.stripRec.addEventListener("click", () => this.toggleRecord());
      if (this.stripPlay) this.stripPlay.addEventListener("click", () => this.togglePlay());

      const bpm = document.getElementById("studio-bpm");
      if (bpm) bpm.addEventListener("input", () => {
        this.bpm = +bpm.value;
        const v = document.getElementById("studio-bpm-val");
        if (v) v.textContent = this.bpm;
        if (root.Tone) Tone.Transport.bpm.value = this.bpm;
        this._applyLoopLength();
      });
      const bars = document.getElementById("studio-bars");
      if (bars) bars.addEventListener("change", () => {
        this._snapshot();
        this.bars = +bars.value;
        this._applyLoopLength();
        this._resizeAllStepGrids();   // grow/shrink drum patterns to new bar count
        if (this.seqTrackId != null) this._renderSequencer();
      });
      const q = document.getElementById("studio-quantize");
      if (q) q.addEventListener("change", () => { this.quantize = q.checked; });
      const m = document.getElementById("studio-metro");
      if (m) m.addEventListener("change", () => { this.metronome = m.checked; this._setupMetro(); });

      this.bindHotkeys();
      this._startPosTicker();
      this._applyMode();
      this.render();
      this._updateEditUI();
    },

    /* ============================================================= */
    /*  Transport                                                    */
    /* ============================================================= */
    _ensureTransport() {
      if (!root.Tone) return;
      Tone.Transport.bpm.value = this.bpm;
      Tone.Transport.loop = true;
      Tone.Transport.loopStart = 0;
      Tone.Transport.loopEnd = this.loopLength();
    },

    _applyLoopLength() {
      if (!root.Tone) return;
      const L = this.loopLength();
      Tone.Transport.loopEnd = L;
      this.tracks.forEach((t) => { if (t.part) t.part.loopEnd = L; });
      // drum sequences span the whole loop; rebuild them to the new length
      this.tracks.forEach((t) => { if (isDrum(t.instrument)) this._buildDrumSeq(t); });
    },

    /* ============================================================= */
    /*  Recording (per-track arm, overdub, count-in, quantize)       */
    /* ============================================================= */

    // Routed here from App.noteHit(note, instrument). Captures the note onto
    // EVERY armed track whose instrument matches `instrument`, overdubbing
    // onto the running loop. Time is taken relative to loop start and snapped
    // to the grid when Quantize is on.
    recordNote(note, instrument) {
      if (!this.recording || this.countingIn || !root.Tone) return;
      const targets = this.tracks.filter((t) => t.armed && t.instrument === instrument);
      if (!targets.length) return;

      const L = this.loopLength();
      let time = ((Tone.Transport.seconds % L) + L) % L; // safe modulo
      if (this.quantize) time = this._snap(time);

      const dur = this.secPerBeat() / 2; // default 8th-note sustain
      targets.forEach((tr) => {
        const ev = { time, note, dur, instrument, vel: 0.85 };
        tr.events.push(ev);
        this._scheduleEvent(tr, ev);   // live-add to the part so it plays next pass
      });
      // (light) refresh note counts without rebuilding the whole list
      this._refreshCounts();
    },

    async toggleRecord() {
      await this.app.startAudio();
      this._ensureTransport();

      if (!this.recording) {
        // Need at least one armed track to capture into.
        const armed = this.tracks.filter((t) => t.armed);
        if (!armed.length) {
          this.app.toast("Arm a track first (●) to record into it");
          return;
        }
        this._snapshot();   // capture pre-take state so undo removes the take
        this._beginRecordWithCountIn();
      } else {
        this._stopRecord();
      }
    },

    // 1-bar count-in: metronome clicks a full bar, THEN recording arms exactly
    // on the next downbeat (loop start). This guarantees the first take lines
    // up with the grid and with every subsequent overdub.
    _beginRecordWithCountIn() {
      this.recBtn && this.recBtn.classList.add("armed");
      if (this.stripRec) this.stripRec.classList.add("armed");

      // Make sure the loop is running so transport time is meaningful.
      if (!this.playing) {
        Tone.Transport.start();
        this.playing = true;
        this._setPlayUI(true);
      }

      this.countingIn = true;
      this.recording = false;     // engaged, but not yet capturing
      this._setRecLabel("Count-in…");
      this.app.toast("Count-in: 1 bar, then record on the downbeat");

      if (!this._metroSynth) this._metroSynth = new Tone.MembraneSynth({ volume: -10 }).toDestination();

      // ── Count-in timing math (explicit, in absolute transport seconds) ──
      // The quantize grid and the metronome are both anchored to transport 0
      // (loopStart). To make the take line up, the count-in clicks one full bar
      // and recording engages on the NEXT bar boundary.
      //
      //   bar      = seconds per bar  (= 4 beats)
      //   now      = current transport position (seconds)
      //   nextBar  = first bar line at or after `now`  (snap up to a multiple of bar)
      //   countEnd = nextBar + bar     ← recording begins here, ON a bar line,
      //                                   which is also a beat line, which is a
      //                                   multiple of the 16th-note quantize grid.
      // The 4 count-in clicks fall at nextBar, nextBar+beat, +2beat, +3beat.
      const beat = this.secPerBeat();
      const bar = this.secPerBar();
      const now = Tone.Transport.seconds;
      const eps = 1e-4;
      const nextBar = Math.ceil((now - eps) / bar) * bar;
      const countEnd = nextBar + bar;

      // Schedule exactly four count-in clicks (one bar), accented on the downbeat.
      this._countIds = [];
      for (let i = 0; i < 4; i++) {
        const at = nextBar + i * beat;
        const accent = i === 0;
        const id = Tone.Transport.scheduleOnce((time) => {
          this._metroSynth.triggerAttackRelease(accent ? "C3" : "C2", "16n", time);
        }, at);
        this._countIds.push(id);
      }

      // Begin capturing exactly on the downbeat after the count-in bar.
      this._recStartId = Tone.Transport.scheduleOnce((time) => {
        Tone.Draw.schedule(() => {
          this.countingIn = false;
          this.recording = true;
          this._setRecLabel("● Recording…");
          this.app.toast("Recording — play the boards");
        }, time);
      }, countEnd);
    },

    _stopRecord() {
      this.recording = false;
      this.countingIn = false;
      if (this._recStartId != null) { try { Tone.Transport.clear(this._recStartId); } catch (e) {} this._recStartId = null; }
      if (this._countIds) { this._countIds.forEach((id) => { try { Tone.Transport.clear(id); } catch (e) {} }); this._countIds = null; }
      this.recBtn && this.recBtn.classList.remove("armed");
      if (this.stripRec) this.stripRec.classList.remove("armed");
      this._setRecLabel("● Record");
      this.render();
      this.app.toast("Take captured");
    },

    _setRecLabel(text) {
      if (this.recBtn) this.recBtn.textContent = text;
      // strip button stays a compact dot; only toggles the armed class
    },

    /* ============================================================= */
    /*  Tracks                                                       */
    /* ============================================================= */

    // Create a NEW empty, recordable track (from the "Add track" button).
    addEmptyTrack(instrument) {
      if (this.tracks.length >= MAX_TRACKS) {
        this.app.toast(`Track limit reached (${MAX_TRACKS})`);
        if (this.addBtn) this.addBtn.disabled = true;
        return null;
      }
      this._snapshot();
      const inst = instrument || this.app.currentSound() || "piano";
      const id = this._nextId++;
      const color = COLORS[(id - 1) % COLORS.length];
      const track = {
        id,
        name: `Track ${this.tracks.length + 1}`,
        instrument: inst,
        events: [],
        steps: null,       // drum step pattern { voice: [bool...] } (drum tracks only)
        seq: null,         // Tone.Sequence (drum tracks only)
        armed: true,       // newly added tracks arm by default (ready to record)
        muted: false,
        soloed: false,
        volume: 0.8,
        color,
        part: null,
      };
      if (isDrum(inst)) {
        this._initSteps(track);
        this._buildDrumSeq(track);
      } else {
        this._buildPart(track);
      }
      if (this.mode === "song") {  // keep loop node silent in song mode
        if (track.part) { try { track.part.stop(0); } catch (e) {} }
        if (track.seq)  { try { track.seq.stop(0);  } catch (e) {} }
      }
      this.tracks.push(track);
      this.render();
      // Drum tracks open the step grid immediately so it's clear how to program.
      if (isDrum(inst)) this.openStepSequencer(id);
      return track;
    },

    // BACKWARD-COMPAT: create a finished track from pre-made events.
    // Used by Spark / Riff / Nathan (events: [{time, note, dur, instrument}]).
    addTrack(name, events, srcLoopLen) {
      if (!root.Tone) return;
      // Grow the loop to fit the incoming material if needed.
      if (srcLoopLen && srcLoopLen > this.loopLength()) {
        const neededBars = Math.ceil(srcLoopLen / this.secPerBar());
        this.bars = Math.max(this.bars, neededBars);
        const sel = document.getElementById("studio-bars");
        if (sel) sel.value = String(this.bars);
        this._applyLoopLength();   // grow existing parts' loopEnd to match
      }
      this._ensureTransport();

      const L = this.loopLength();
      const id = this._nextId++;
      const color = COLORS[(id - 1) % COLORS.length];
      const inst = (events[0] && events[0].instrument) || "piano";
      const evs = events.map((e) => ({
        time: Math.min(e.time, L - 0.001),
        note: e.note,
        dur: e.dur != null ? e.dur : this.secPerBeat() / 2,
        instrument: e.instrument || inst,
        vel: e.vel != null ? e.vel : 0.82,
      }));
      this._snapshot();
      const track = {
        id,
        name: name || `Take ${this.tracks.length + 1}`,
        instrument: inst,
        events: evs,
        steps: null,
        seq: null,
        armed: false,
        muted: false,
        soloed: false,
        volume: 0.8,
        color,
        part: null,
      };
      this._buildPart(track);
      this.tracks.push(track);
      this.render();
      if (!this.playing) this.togglePlay();
      return track;
    },

    // (Re)build a track's Tone.Part from its events. Playback reads LIVE track
    // state every callback so mute / solo / volume changes apply instantly.
    _buildPart(track) {
      if (!root.Tone) return;
      if (track.part) { try { track.part.dispose(); } catch (e) {} track.part = null; }
      const L = this.loopLength();
      const part = new Tone.Part((time, ev) => {
        const tr = this.tracks.find((t) => t.id === track.id);
        if (!tr) return;
        if (!this._audibleNow(tr)) return;
        const vel = (ev.vel != null ? ev.vel : 0.82) * tr.volume;
        AudioEngine.play(ev.note, ev.dur, vel, time, ev.instrument || tr.instrument);
        Tone.Draw.schedule(() => this.app.flashNote(ev.note), time);
      }, track.events.map((e) => [e.time, e]));
      part.loop = true;
      part.loopEnd = L;
      part.start(0);
      track.part = part;
    },

    // Live-append a single event to a track's running Part (used while recording).
    _scheduleEvent(track, ev) {
      if (track.part) { try { track.part.add(ev.time, ev); } catch (e) {} }
    },

    // Solo/mute resolution: if ANY track is soloed, only soloed tracks sound.
    // Otherwise, muted tracks are silent. Checked live in the Part callback.
    _audibleNow(tr) {
      const anySolo = this.tracks.some((t) => t.soloed);
      if (anySolo) return tr.soloed && !tr.muted;
      return !tr.muted;
    },

    /* ============================================================= */
    /*  Drum step patterns (FL-style step sequencer)                 */
    /* ============================================================= */
    stepCount() { return STEPS_PER_BAR * this.bars; },

    // Create an empty step pattern sized to the current loop, one row per voice.
    _initSteps(track) {
      const n = this.stepCount();
      track.steps = {};
      DRUM_VOICES().forEach((v) => { track.steps[v.id] = new Array(n).fill(false); });
    },

    // Grow/shrink an existing pattern to match the current bar count, keeping
    // the first min(old,new) steps of each row.
    _resizeSteps(track) {
      if (!track.steps) { this._initSteps(track); return; }
      const n = this.stepCount();
      DRUM_VOICES().forEach((v) => {
        const old = track.steps[v.id] || [];
        const next = new Array(n).fill(false);
        for (let i = 0; i < Math.min(old.length, n); i++) next[i] = !!old[i];
        track.steps[v.id] = next;
      });
    },

    _resizeAllStepGrids() {
      this.tracks.forEach((t) => {
        if (!isDrum(t.instrument)) return;
        this._resizeSteps(t);
        this._buildDrumSeq(t);
      });
    },

    // (Re)build a track's Tone.Sequence from its step pattern. The sequence has
    // one entry per step (16th notes); each callback fires every active voice on
    // that step at the callback's absolute `time` (sample-accurate). Live track
    // state is read every callback, so solo/mute/volume apply instantly, and the
    // active kit is resolved per-track via the instrument id.
    _buildDrumSeq(track) {
      if (!root.Tone) return;
      if (track.seq) { try { track.seq.dispose(); } catch (e) {} track.seq = null; }
      const n = this.stepCount();
      const idx = Array.from({ length: n }, (_, i) => i);
      const kit = kitFor(track.instrument);
      const seq = new Tone.Sequence((time, step) => {
        const tr = this.tracks.find((t) => t.id === track.id);
        if (!tr || !tr.steps) return;
        if (!this._audibleNow(tr)) return;
        if (!root.Drums) return;
        DRUM_VOICES().forEach((v) => {
          const row = tr.steps[v.id];
          if (row && row[step]) {
            root.Drums.trigger(v.id, time, 0.9 * tr.volume, kit);
          }
        });
        // playhead highlight (only while the open grid belongs to this track)
        if (this.seqTrackId === tr.id) {
          Tone.Draw.schedule(() => this._highlightStep(step), time);
        }
      }, idx, "16n");
      seq.loop = true;
      seq.start(0);
      track.seq = seq;
    },

    setTrackInstrument(id, inst) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t) return;
      if (t.instrument === inst) return;
      this._snapshot();
      const wasDrum = isDrum(t.instrument);
      const nowDrum = isDrum(inst);
      t.instrument = inst;

      if (nowDrum) {
        // Switching INTO a drum kit: drop the melodic Part, set up steps + seq.
        if (t.part) { try { t.part.dispose(); } catch (e) {} t.part = null; }
        if (!t.steps) this._initSteps(t); else this._resizeSteps(t);
        if (root.Drums && root.Drums.setKit) root.Drums.setKit(kitFor(inst));
        this._buildDrumSeq(t);
        this.openStepSequencer(id);
      } else if (wasDrum) {
        // Switching OUT of a drum kit: drop the seq, rebuild the melodic Part.
        if (t.seq) { try { t.seq.dispose(); } catch (e) {} t.seq = null; }
        if (this.seqTrackId === id) this.closeStepSequencer();
        this._buildPart(t);
      }
      // events with no explicit instrument inherit the track instrument on play
      this.render();
    },
    setTrackName(id, name) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t || t.name === name) return;
      this._snapshot();
      t.name = name;
    },
    // snapshot taken on volume "change" (drag end) via _volSnapshot, not here
    setTrackVolume(id, vol) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) t.volume = Math.max(0, Math.min(1, vol));
    },
    _volSnapshot() { this._snapshot(); },
    toggleArm(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) { this._snapshot(); t.armed = !t.armed; this.render(); }
    },
    toggleMute(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) { this._snapshot(); t.muted = !t.muted; this.render(); }
    },
    toggleSolo(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) { this._snapshot(); t.soloed = !t.soloed; this.render(); }
    },

    removeTrack(id) {
      const i = this.tracks.findIndex((x) => x.id === id);
      if (i < 0) return;
      this._snapshot();
      try { this.tracks[i].part.dispose(); } catch (e) {}
      try { this.tracks[i].seq.dispose(); } catch (e) {}
      if (this.seqTrackId === id) this.closeStepSequencer();
      // drop any arrangement clips bound to this track
      this.clips = this.clips.filter((c) => c.trackId !== id);
      this._selTracks = this._selTracks.filter((x) => x !== id);
      this.tracks.splice(i, 1);
      if (this.addBtn) this.addBtn.disabled = this.tracks.length >= MAX_TRACKS;
      this._autoSizeSong();
      this.render();
      this._updateEditUI();
      if (!this.tracks.length) this.app.toast("All tracks cleared");
    },

    clearAll() {
      if (this.tracks.length || this.clips.length) this._snapshot();
      if (this._songPlaying) this._stopSong();
      this.tracks.forEach((t) => {
        try { t.part.dispose(); } catch (e) {}
        try { t.seq.dispose(); } catch (e) {}
      });
      this.closeStepSequencer();
      this.tracks = [];
      this.clips = [];
      this._clearSelection();
      this.songLen = this.SONG_MIN;
      if (this.recording || this.countingIn) this._stopRecord();
      if (root.Tone) { Tone.Transport.stop(); Tone.Transport.position = 0; }
      this.playing = false;
      this._setPlayUI(false);
      if (this.addBtn) this.addBtn.disabled = false;
      this.render();
      this._updateEditUI();
    },

    /* ============================================================= */
    /*  Play / Stop                                                  */
    /* ============================================================= */
    async togglePlay() {
      await this.app.startAudio();

      // ── SONG MODE: linear timeline playback ──
      if (this.mode === "song") {
        if (this._songPlaying) {
          this._stopSong();             // stop returns playhead to start
        } else {
          if (!this.clips.length) { this.app.toast("Add a clip to the song first (＋ Add)"); return; }
          this._startSong();
        }
        return;
      }

      // ── LOOP MODE: today's behaviour ──
      this._ensureTransport();
      if (this.playing) {
        Tone.Transport.pause();
        this.playing = false;
        this._setPlayUI(false);
        // pausing while recording stops the take cleanly
        if (this.recording || this.countingIn) this._stopRecord();
      } else {
        Tone.Transport.start();
        this.playing = true;
        this._setPlayUI(true);
      }
    },

    _setPlayUI(on) {
      if (this.playBtn) {
        this.playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
        this.playBtn.classList.toggle("active", on);
      }
      if (this.stripPlay) {
        this.stripPlay.textContent = on ? "❚❚" : "▶";
        this.stripPlay.classList.toggle("active", on);
      }
      if (!on && this.seqEl) {
        this.seqEl.querySelectorAll(".seq-cell.playhead")
          .forEach((c) => c.classList.remove("playhead"));
      }
    },

    /* ============================================================= */
    /*  Metronome                                                    */
    /* ============================================================= */
    _setupMetro() {
      if (!root.Tone) return;
      if (this.metronome) {
        if (!this._metroSynth) this._metroSynth = new Tone.MembraneSynth({ volume: -10 }).toDestination();
        if (!this._metroLoop) {
          let beat = 0;
          this._metroLoop = new Tone.Loop((time) => {
            const accent = (beat % 4) === 0;
            this._metroSynth.triggerAttackRelease(accent ? "C3" : "C2", "16n", time);
            beat++;
          }, "4n");
        }
        // Align metronome to the beat grid (and therefore the quantize grid).
        this._metroLoop.start(0);
      } else if (this._metroLoop) {
        this._metroLoop.stop();
      }
    },

    /* ============================================================= */
    /*  Position ticker (transport readout)                          */
    /* ============================================================= */
    _startPosTicker() {
      if (this._posTimer) return;
      this._posTimer = setInterval(() => {
        if (!root.Tone || !this.playing) return;
        let txt;
        if (this.mode === "song") {
          const t = ((Tone.Transport.seconds % this.songLen) + this.songLen) % this.songLen;
          const m = Math.floor(t / 60), s = Math.floor(t % 60);
          txt = `${m}:${s < 10 ? "0" : ""}${s}`;
        } else {
          const L = this.loopLength();
          const t = ((Tone.Transport.seconds % L) + L) % L;
          const beat = Math.floor(t / this.secPerBeat());
          const bar = Math.floor(beat / 4) + 1;
          const beatInBar = (beat % 4) + 1;
          txt = `${bar}.${beatInBar}`;
        }
        if (this.posEl) this.posEl.textContent = txt;
        if (this.stripPos) this.stripPos.textContent = txt;
      }, 90);
    },

    /* ============================================================= */
    /*  Hotkeys                                                      */
    /* ============================================================= */
    _typing(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    },
    _onStudio() {
      const p = document.querySelector('[data-panel="studio"]');
      return !!p && p.classList.contains("active");
    },

    bindHotkeys() {
      document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (this._typing(document.activeElement)) return;

        switch (e.code) {
          case "Space":            // Play/Stop — any tab
            e.preventDefault();
            this.togglePlay();
            return;
          case "KeyQ":             // Record toggle
            e.preventDefault();
            this.toggleRecord();
            return;
          case "KeyW":             // Play/Pause
            e.preventDefault();
            this.togglePlay();
            return;
          case "KeyE":             // Clear all
            e.preventDefault();
            this.clearAll();
            return;
          // Edit hotkeys — only act on the Studio page (harmless elsewhere).
          case "Backspace":         // Undo
            if (this._onStudio()) { e.preventDefault(); this.undo(); }
            return;
          case "Home":              // Redo
            if (this._onStudio()) { e.preventDefault(); this.redo(); }
            return;
          case "Insert":            // Copy selection
            if (this._onStudio()) { e.preventDefault(); this.copySelection(); }
            return;
          case "Pause":             // Paste
            if (this._onStudio()) { e.preventDefault(); this.pasteClipboard(); }
            return;
          case "Delete":            // Delete selected clip(s) in Song mode
            if (this._onStudio() && this.mode === "song" && this._selClips.length) {
              e.preventDefault(); this.deleteSelectedClips();
            }
            return;
          default:
            return;
        }
      });
    },

    /* ============================================================= */
    /*  Undo / Redo  (state snapshots)                               */
    /* ============================================================= */

    // Serialize ONE track's persistent data (no Tone nodes).
    _serializeTrack(t) {
      return {
        id: t.id,
        name: t.name,
        instrument: t.instrument,
        events: (t.events || []).map((e) => ({
          time: e.time, note: e.note, dur: e.dur,
          instrument: e.instrument, vel: e.vel,
        })),
        steps: t.steps ? JSON.parse(JSON.stringify(t.steps)) : null,
        armed: !!t.armed,
        muted: !!t.muted,
        soloed: !!t.soloed,
        volume: t.volume,
        color: t.color,
      };
    },

    // Serialize ONE arrangement clip (no Tone nodes).
    _serializeClip(c) {
      return {
        id: c.id, trackId: c.trackId, start: c.start, len: c.len,
        kind: c.kind, instrument: c.instrument, color: c.color, name: c.name,
        events: (c.events || []).map((e) => ({
          time: e.time, note: e.note, dur: e.dur,
          instrument: e.instrument, vel: e.vel,
        })),
        steps: c.steps ? JSON.parse(JSON.stringify(c.steps)) : null,
        srcBars: c.srcBars, srcBpm: c.srcBpm,
      };
    },

    // Full serializable Studio state (deep, plain JSON).
    _serializeState() {
      return {
        bpm: this.bpm,
        bars: this.bars,
        mode: this.mode,
        songLen: this.songLen,
        nextId: this._nextId,
        nextClipId: this._nextClipId,
        seqTrackId: this.seqTrackId,
        selTracks: this._selTracks.slice(),
        selClips: this._selClips.slice(),
        tracks: this.tracks.map((t) => this._serializeTrack(t)),
        clips: this.clips.map((c) => this._serializeClip(c)),
      };
    },

    // Push the CURRENT state onto the undo stack BEFORE a mutating action.
    // Clears the redo stack (new branch of history). Bounded to _HISTORY_MAX.
    _snapshot() {
      if (this._restoring) return;
      this._history.push(JSON.stringify(this._serializeState()));
      if (this._history.length > this._HISTORY_MAX) this._history.shift();
      this._redo.length = 0;
      this._updateEditUI();
    },

    // Tear down ALL live Tone nodes (parts + sequences) without touching data.
    _disposeAllNodes() {
      this.tracks.forEach((t) => {
        if (t.part) { try { t.part.dispose(); } catch (e) {} t.part = null; }
        if (t.seq)  { try { t.seq.dispose();  } catch (e) {} t.seq  = null; }
      });
    },

    // Rebuild a track's live Tone node(s) from its (restored) data.
    _rebuildTrackNodes(t) {
      if (isDrum(t.instrument)) {
        if (!t.steps) this._initSteps(t); else this._resizeSteps(t);
        this._buildDrumSeq(t);
      } else {
        this._buildPart(t);
      }
      if (this.mode === "song") {  // keep loop nodes silent in song mode
        if (t.part) { try { t.part.stop(0); } catch (e) {} }
        if (t.seq)  { try { t.seq.stop(0);  } catch (e) {} }
      }
    },

    // Restore a serialized state object: rebuild data + Tone nodes cleanly.
    _restoreState(snap) {
      if (!snap) return;
      const st = (typeof snap === "string") ? JSON.parse(snap) : snap;
      this._restoring = true;

      // stop song playback if running (avoids dangling scheduled clips)
      if (this._songPlaying) this._stopSong();

      // dispose existing nodes (no leaks)
      this._disposeAllNodes();

      this.bpm = st.bpm;
      this.bars = st.bars;
      this.mode = st.mode || "loop";
      this.songLen = st.songLen != null ? st.songLen : this.SONG_MIN;
      this._nextId = st.nextId;
      this._nextClipId = st.nextClipId || 1;
      this._selTracks = (st.selTracks || []).slice();
      this._selClips = (st.selClips || []).slice();

      // rebuild tracks
      this.tracks = (st.tracks || []).map((s) => ({
        id: s.id, name: s.name, instrument: s.instrument,
        events: (s.events || []).map((e) => ({ ...e })),
        steps: s.steps ? JSON.parse(JSON.stringify(s.steps)) : null,
        seq: null, part: null,
        armed: s.armed, muted: s.muted, soloed: s.soloed,
        volume: s.volume, color: s.color,
      }));

      // rebuild clips (data only)
      this.clips = (st.clips || []).map((s) => ({ ...this._serializeClip(s) }));

      // reflect bpm/bars into the transport + UI controls
      if (root.Tone) Tone.Transport.bpm.value = this.bpm;
      const barsSel = document.getElementById("studio-bars");
      if (barsSel) barsSel.value = String(this.bars);
      const bpmSlider = document.getElementById("studio-bpm");
      if (bpmSlider) bpmSlider.value = String(this.bpm);
      const bpmVal = document.getElementById("studio-bpm-val");
      if (bpmVal) bpmVal.textContent = this.bpm;
      this._ensureTransport();

      // rebuild live nodes from data
      this.tracks.forEach((t) => this._rebuildTrackNodes(t));

      // restore open step grid if that track still exists & is a drum
      const seqT = this.tracks.find((t) => t.id === st.seqTrackId);
      this.seqTrackId = (seqT && isDrum(seqT.instrument)) ? seqT.id : null;

      this._restoring = false;
      this._applyMode();      // re-apply Loop/Song view + transport behaviour
      this.render();
      if (this.seqTrackId != null) this._renderSequencer(); else this.closeStepSequencer();
      this._updateEditUI();
    },

    undo() {
      if (!this._history.length) { this.app && this.app.toast("Nothing to undo"); return; }
      const current = JSON.stringify(this._serializeState());
      const prev = this._history.pop();
      this._redo.push(current);
      if (this._redo.length > this._HISTORY_MAX) this._redo.shift();
      this._restoreState(prev);
      this.app && this.app.toast("Undo");
    },

    redo() {
      if (!this._redo.length) { this.app && this.app.toast("Nothing to redo"); return; }
      const current = JSON.stringify(this._serializeState());
      const next = this._redo.pop();
      this._history.push(current);
      if (this._history.length > this._HISTORY_MAX) this._history.shift();
      this._restoreState(next);
      this.app && this.app.toast("Redo");
    },

    _updateEditUI() {
      const u = document.getElementById("studio-undo");
      const r = document.getElementById("studio-redo");
      const cp = document.getElementById("studio-copy");
      const pa = document.getElementById("studio-paste");
      if (u) u.disabled = this._history.length === 0;
      if (r) r.disabled = this._redo.length === 0;
      if (cp) cp.disabled = (this._selTracks.length === 0 && this._selClips.length === 0);
      if (pa) pa.disabled = !this._clipboard;
    },

    /* ============================================================= */
    /*  Selection (mixer tracks in Loop mode; clips in Song mode)    */
    /* ============================================================= */
    _clearSelection() {
      this._selTracks = [];
      this._selClips = [];
    },

    selectTrack(id, additive) {
      if (additive) {
        const i = this._selTracks.indexOf(id);
        if (i >= 0) this._selTracks.splice(i, 1); else this._selTracks.push(id);
      } else {
        this._selTracks = [id];
      }
      this._selClips = [];
      this.render();
      this._updateEditUI();
    },

    selectClip(id, additive) {
      if (additive) {
        const i = this._selClips.indexOf(id);
        if (i >= 0) this._selClips.splice(i, 1); else this._selClips.push(id);
      } else {
        this._selClips = [id];
      }
      this._selTracks = [];
      this.renderArrangement();
      this._updateEditUI();
    },

    /* ============================================================= */
    /*  Copy / Paste                                                 */
    /* ============================================================= */
    copySelection() {
      if (this.mode === "song" && this._selClips.length) {
        const clips = this.clips
          .filter((c) => this._selClips.includes(c.id))
          .map((c) => this._serializeClip(c));
        this._clipboard = { kind: "clips", clips };
        this.app && this.app.toast(`Copied ${clips.length} clip(s)`);
      } else if (this._selTracks.length) {
        const tracks = this.tracks
          .filter((t) => this._selTracks.includes(t.id))
          .map((t) => this._serializeTrack(t));
        this._clipboard = { kind: "tracks", tracks };
        this.app && this.app.toast(`Copied ${tracks.length} track(s)`);
      } else {
        this.app && this.app.toast("Select a track or clip to copy");
      }
      this._updateEditUI();
    },

    pasteClipboard() {
      if (!this._clipboard) { this.app && this.app.toast("Clipboard empty"); return; }

      if (this._clipboard.kind === "tracks") {
        const incoming = this._clipboard.tracks;
        const room = MAX_TRACKS - this.tracks.length;
        if (room <= 0) { this.app && this.app.toast(`Track limit reached (${MAX_TRACKS})`); return; }
        const toAdd = incoming.slice(0, room);
        this._snapshot();
        const newIds = [];
        toAdd.forEach((s) => {
          const id = this._nextId++;
          const t = {
            id,
            name: s.name + " copy",
            instrument: s.instrument,
            events: (s.events || []).map((e) => ({ ...e })),
            steps: s.steps ? JSON.parse(JSON.stringify(s.steps)) : null,
            seq: null, part: null,
            armed: false, muted: s.muted, soloed: false,
            volume: s.volume, color: COLORS[(id - 1) % COLORS.length],
          };
          this._rebuildTrackNodes(t);
          this.tracks.push(t);
          newIds.push(id);
        });
        this._selTracks = newIds;
        this._selClips = [];
        this.render();
        if (incoming.length > room)
          this.app && this.app.toast(`Pasted ${toAdd.length}; track limit (${MAX_TRACKS}) reached`);
        else
          this.app && this.app.toast(`Pasted ${toAdd.length} track(s)`);
        this._updateEditUI();
        return;
      }

      if (this._clipboard.kind === "clips") {
        if (this.mode !== "song") { this.app && this.app.toast("Switch to Song mode to paste clips"); return; }
        const incoming = this._clipboard.clips;
        if (!incoming.length) return;
        // paste anchored at the playhead (or just after the selection end)
        let anchor = this._playheadSec();
        if (this._selClips.length) {
          const sel = this.clips.filter((c) => this._selClips.includes(c.id));
          anchor = Math.max(...sel.map((c) => c.start + c.len));
        }
        const base = Math.min(...incoming.map((c) => c.start));
        this._snapshot();
        const newIds = [];
        let blocked = false;
        incoming.forEach((s) => {
          const start = anchor + (s.start - base);
          if (start + s.len > this.SONG_MAX) { blocked = true; return; }
          const id = this._nextClipId++;
          this.clips.push({
            id, trackId: s.trackId, start, len: s.len, kind: s.kind,
            instrument: s.instrument, color: s.color, name: s.name,
            events: (s.events || []).map((e) => ({ ...e })),
            steps: s.steps ? JSON.parse(JSON.stringify(s.steps)) : null,
            srcBars: s.srcBars, srcBpm: s.srcBpm,
          });
          newIds.push(id);
        });
        this._selClips = newIds;
        this._selTracks = [];
        this._growSongToFit();
        this._autoSizeSong();
        this.renderArrangement();
        if (blocked) this.app && this.app.toast("Some clips exceeded the 8:00 cap");
        else this.app && this.app.toast(`Pasted ${newIds.length} clip(s)`);
        this._updateEditUI();
        return;
      }
    },

    /* ============================================================= */
    /*  Loop ⇄ Song mode                                             */
    /* ============================================================= */
    setMode(mode) {
      if (mode !== "loop" && mode !== "song") return;
      if (this.mode === mode) return;
      // stop whatever is playing before switching
      if (this._songPlaying) this._stopSong();
      if (this.playing) {
        if (root.Tone) { Tone.Transport.stop(); Tone.Transport.position = 0; }
        this.playing = false; this._setPlayUI(false);
      }
      this.mode = mode;
      this._clearSelection();
      this._applyMode();
      this.render();
      this._updateEditUI();
    },

    // The per-track loop nodes (Part/Sequence) are always scheduled on the
    // transport in Loop mode. In Song mode they must be silenced so they don't
    // double up with the song's own scheduled clips.
    _stopLoopNodes() {
      this.tracks.forEach((t) => {
        if (t.part) { try { t.part.stop(0); } catch (e) {} }
        if (t.seq)  { try { t.seq.stop(0);  } catch (e) {} }
      });
    },
    _startLoopNodes() {
      this.tracks.forEach((t) => {
        if (t.part) { try { t.part.start(0); } catch (e) {} }
        if (t.seq)  { try { t.seq.start(0);  } catch (e) {} }
      });
    },

    // Apply view + transport config for the current mode (no playback start).
    _applyMode() {
      const loopBtn = document.getElementById("studio-mode-loop");
      const songBtn = document.getElementById("studio-mode-song");
      if (loopBtn) loopBtn.classList.toggle("active", this.mode === "loop");
      if (songBtn) songBtn.classList.toggle("active", this.mode === "song");

      const arr = this.arrangeEl;
      if (this.mode === "song") {
        this._stopLoopNodes();   // silence loop parts; song schedules its own
        if (root.Tone) {
          // Loop the whole song; per-mode parts live only while playing.
          Tone.Transport.loop = true;
          Tone.Transport.loopStart = 0;
          Tone.Transport.loopEnd = this.songLen;
        }
        if (arr) arr.classList.add("on");
        this.renderArrangement();
      } else {
        this._ensureTransport(); // restore loop-mode transport bounds
        this._startLoopNodes();  // re-arm loop parts for loop playback
        if (arr) { arr.classList.remove("on"); arr.innerHTML = ""; }
      }
    },

    /* ============================================================= */
    /*  Arrangement clips (Song mode)                                */
    /* ============================================================= */

    // Capture the current loop/pattern of `trackId` as a clip at the playhead.
    addClipFromTrack(trackId) {
      const t = this.tracks.find((x) => x.id === trackId);
      if (!t) return;
      const len = this.loopLength();
      let start = this._playheadSec();
      // append after the last clip in this track's lane if playhead sits inside one
      const lane = this.clips.filter((c) => c.trackId === trackId)
        .sort((a, b) => a.start - b.start);
      for (const c of lane) {
        if (start < c.start + c.len - 1e-3 && start + len > c.start + 1e-3) {
          start = c.start + c.len; // nudge past overlap
        }
      }
      if (start + len > this.SONG_MAX) {
        this.app && this.app.toast("Song is at the 8:00 cap");
        return;
      }
      this._snapshot();
      const drum = isDrum(t.instrument);
      const clip = {
        id: this._nextClipId++,
        trackId: t.id,
        start,
        len,
        kind: drum ? "drum" : "loop",
        instrument: t.instrument,
        color: t.color,
        name: t.name,
        events: drum ? [] : t.events.map((e) => ({ ...e })),
        steps: drum ? JSON.parse(JSON.stringify(t.steps || {})) : null,
        srcBars: this.bars,
        srcBpm: this.bpm,
      };
      this.clips.push(clip);
      this._selClips = [clip.id];
      this._selTracks = [];
      this._growSongToFit();
      this._autoSizeSong();
      this.renderArrangement();
      this.app && this.app.toast(`Added "${t.name}" to song`);
      this._updateEditUI();
    },

    deleteClip(clipId) {
      const i = this.clips.findIndex((c) => c.id === clipId);
      if (i < 0) return;
      this._snapshot();
      this.clips.splice(i, 1);
      this._selClips = this._selClips.filter((x) => x !== clipId);
      this._autoSizeSong();
      this.renderArrangement();
      this._updateEditUI();
    },

    deleteSelectedClips() {
      if (!this._selClips.length) return;
      this._snapshot();
      this.clips = this.clips.filter((c) => !this._selClips.includes(c.id));
      this._selClips = [];
      this._autoSizeSong();
      this.renderArrangement();
      this._updateEditUI();
    },

    // Move a clip to a new start time (drag); clamps to >=0 and the 8:00 cap.
    moveClip(clipId, newStart, snapshot) {
      const c = this.clips.find((x) => x.id === clipId);
      if (!c) return;
      if (snapshot) this._snapshot();
      let s = Math.max(0, newStart);
      if (s + c.len > this.SONG_MAX) s = this.SONG_MAX - c.len;
      c.start = s;
      this._growSongToFit();
      this._autoSizeSong();
      this.renderArrangement();
      this._updateEditUI();
    },

    // The furthest point any clip reaches.
    _songEnd() {
      let end = 0;
      this.clips.forEach((c) => { if (c.start + c.len > end) end = c.start + c.len; });
      return end;
    },

    // Grow the canvas if a clip now reaches past the current songLen (cap 8:00).
    _growSongToFit() {
      const end = this._songEnd();
      if (end > this.songLen) {
        this.songLen = Math.min(this.SONG_MAX, end);
        if (root.Tone && this.mode === "song") Tone.Transport.loopEnd = this.songLen;
      }
    },

    // Auto-size: grow to fit content, retract to just past the last clip when
    // there is empty tail space. Never below SONG_MIN, never above SONG_MAX.
    _autoSizeSong() {
      const end = this._songEnd();
      // pad a little so the last clip isn't flush with the edge
      let target = Math.max(this.SONG_MIN, Math.ceil(end + 4));
      target = Math.min(this.SONG_MAX, target);
      if (target !== this.songLen) {
        this.songLen = target;
        if (root.Tone && this.mode === "song") Tone.Transport.loopEnd = this.songLen;
      }
    },

    // Current playhead position in seconds within the song (0 if not playing).
    _playheadSec() {
      if (!root.Tone) return 0;
      if (this.mode === "song" && this._songPlaying) {
        return ((Tone.Transport.seconds % this.songLen) + this.songLen) % this.songLen;
      }
      return 0;
    },

    /* ============================================================= */
    /*  Song playback (linear timeline)                              */
    /* ============================================================= */
    _startSong() {
      if (!root.Tone) return;
      this._stopSong();           // clear any prior scheduling
      Tone.Transport.loop = true;
      Tone.Transport.loopStart = 0;
      Tone.Transport.loopEnd = this.songLen;
      Tone.Transport.position = 0;

      // One Tone.Part covers ALL clip note-events, placed at absolute song time.
      const noteEvents = [];
      const drumEvents = [];
      this.clips.forEach((c) => {
        if (c.kind === "loop") {
          (c.events || []).forEach((e) => {
            noteEvents.push([c.start + e.time, { ev: e, clip: c }]);
          });
        } else if (c.kind === "drum" && c.steps) {
          // expand the step grid into absolute hits
          const bars = c.srcBars || this.bars;
          const stepsN = STEPS_PER_BAR * bars;
          const grid = (60 / (c.srcBpm || this.bpm)) / 4; // 16th-note seconds
          DRUM_VOICES().forEach((v) => {
            const row = c.steps[v.id];
            if (!row) return;
            for (let i = 0; i < stepsN && i < row.length; i++) {
              if (row[i]) drumEvents.push([c.start + i * grid, { voice: v.id, clip: c }]);
            }
          });
        }
      });

      if (noteEvents.length) {
        const part = new Tone.Part((time, payload) => {
          const tr = this.tracks.find((t) => t.id === payload.clip.trackId);
          const aud = tr ? this._audibleNow(tr) : true;
          if (!aud) return;
          const vol = tr ? tr.volume : 0.8;
          const e = payload.ev;
          AudioEngine.play(e.note, e.dur, (e.vel != null ? e.vel : 0.82) * vol,
            time, e.instrument || payload.clip.instrument);
          Tone.Draw.schedule(() => this.app.flashNote(e.note), time);
        }, noteEvents);
        part.loop = false;
        part.start(0);
        this._songParts.push(part);
      }

      if (drumEvents.length && root.Drums) {
        const dpart = new Tone.Part((time, payload) => {
          const tr = this.tracks.find((t) => t.id === payload.clip.trackId);
          const aud = tr ? this._audibleNow(tr) : true;
          if (!aud) return;
          const vol = tr ? tr.volume : 0.8;
          root.Drums.trigger(payload.voice, time, 0.9 * vol, kitFor(payload.clip.instrument));
        }, drumEvents);
        dpart.loop = false;
        dpart.start(0);
        this._songParts.push(dpart);
      }

      Tone.Transport.start();
      this._songPlaying = true;
      this.playing = true;
      this._setPlayUI(true);
      this._startSongPlayhead();
    },

    _stopSong() {
      if (root.Tone) {
        Tone.Transport.stop();
        Tone.Transport.position = 0;
      }
      this._songParts.forEach((p) => { try { p.dispose(); } catch (e) {} });
      this._songParts = [];
      this._songPlaying = false;
      this.playing = false;
      this._setPlayUI(false);
      if (this._songPhTimer) { clearInterval(this._songPhTimer); this._songPhTimer = null; }
      const ph = this.arrangeEl && this.arrangeEl.querySelector(".arr-playhead");
      if (ph) ph.style.left = "0px";
    },

    _startSongPlayhead() {
      if (this._songPhTimer) clearInterval(this._songPhTimer);
      this._songPhTimer = setInterval(() => {
        if (!this._songPlaying || !this.arrangeEl) return;
        const ph = this.arrangeEl.querySelector(".arr-playhead");
        const lanesEl = this.arrangeEl.querySelector(".arr-lanes");
        if (!ph || !lanesEl) return;
        const t = ((Tone.Transport.seconds % this.songLen) + this.songLen) % this.songLen;
        const px = (t / this.songLen) * lanesEl.clientWidth;
        ph.style.left = px + "px";
      }, 60);
    },

    /* ============================================================= */
    /*  Arrangement canvas render                                    */
    /* ============================================================= */
    renderArrangement() {
      const host = this.arrangeEl;
      if (!host) return;
      if (this.mode !== "song") { host.innerHTML = ""; return; }

      const L = this.songLen;
      const bar = this.secPerBar();
      const mm = (s) => {
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? "0" : ""}${sec}`;
      };

      // time ruler — a tick every bar, labelled every 4 bars (and at seconds)
      let ticks = "";
      const nBars = Math.ceil(L / bar);
      for (let b = 0; b <= nBars; b++) {
        const s = b * bar;
        if (s > L) break;
        const pct = (s / L) * 100;
        const major = (b % 4 === 0);
        ticks += `<div class="arr-tick${major ? " major" : ""}" style="left:${pct}%">` +
          (major ? `<span>${mm(s)}</span>` : "") + `</div>`;
      }

      // lanes — one per track (so empty tracks still show a drop target)
      let lanes = "";
      this.tracks.forEach((t) => {
        const laneClips = this.clips.filter((c) => c.trackId === t.id);
        let clipEls = "";
        laneClips.forEach((c) => {
          const left = (c.start / L) * 100;
          const w = (c.len / L) * 100;
          const sel = this._selClips.includes(c.id) ? " selected" : "";
          clipEls +=
            `<div class="arr-clip${sel}" data-clip="${c.id}"
                  style="left:${left}%; width:${w}%; --cc:${c.color}"
                  title="${c.name} · ${mm(c.start)}–${mm(c.start + c.len)}">
               <span class="arr-clip-name">${c.name}</span>
               <button class="arr-clip-del" data-clip-del="${c.id}" title="Delete clip">✕</button>
             </div>`;
        });
        lanes +=
          `<div class="arr-lane" data-lane="${t.id}">
             <div class="arr-lane-head">
               <span class="arr-lane-dot" style="background:${t.color}"></span>
               <span class="arr-lane-name" title="${t.name}">${t.name}</span>
               <button class="arr-add" data-arr-add="${t.id}" title="Add this loop/pattern to the song at the playhead">＋ Add</button>
             </div>
             <div class="arr-lane-body">${clipEls}</div>
           </div>`;
      });

      if (!this.tracks.length) {
        host.innerHTML =
          `<div class="arr glass"><div class="arr-empty muted">No tracks yet — add a track,
            program a loop or beat, switch to <b>Song</b> and hit <b>＋ Add</b> to drop it on the timeline.</div></div>`;
        return;
      }

      host.innerHTML =
        `<div class="arr glass">
           <div class="arr-head">
             <span class="arr-title">▤ Song timeline <span class="arr-len">${mm(L)} / 8:00 max</span></span>
             <span class="arr-hint muted">＋ Add drops the current loop/pattern · click clip to select · drag to move · ✕ delete</span>
           </div>
           <div class="arr-ruler">${ticks}</div>
           <div class="arr-lanes">
             <div class="arr-playhead"></div>
             ${lanes}
           </div>
         </div>`;

      // wire: add-to-song, delete clip, select clip, drag-move
      host.querySelectorAll("[data-arr-add]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.addClipFromTrack(+b.dataset.arrAdd);
        }));
      host.querySelectorAll("[data-clip-del]").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.deleteClip(+b.dataset.clipDel);
        }));
      host.querySelectorAll(".arr-clip").forEach((el) =>
        this._wireClipDrag(el, host));
    },

    // Click-to-select + drag-to-move (within the same lane) for a clip element.
    _wireClipDrag(el, host) {
      const clipId = +el.dataset.clip;
      let dragging = false, startX = 0, origStart = 0, snapped = false, moved = false;

      const onDown = (e) => {
        if (e.target.closest(".arr-clip-del")) return;
        const c = this.clips.find((x) => x.id === clipId);
        if (!c) return;
        dragging = true; moved = false; snapped = false;
        startX = e.clientX;
        origStart = c.start;
        this.selectClip(clipId, e.shiftKey);
        e.preventDefault();
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };
      const onMove = (e) => {
        if (!dragging) return;
        const lanesEl = host.querySelector(".arr-lanes");
        if (!lanesEl) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        const secPerPx = this.songLen / lanesEl.clientWidth;
        let ns = origStart + dx * secPerPx;
        if (ns < 0) ns = 0;
        if (!snapped) { this._snapshot(); snapped = true; } // one snapshot per drag
        this.moveClip(clipId, ns, false);
      };
      const onUp = () => {
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      el.addEventListener("mousedown", onDown);
    },

    /* ============================================================= */
    /*  Step sequencer UI (FL-style drum grid)                       */
    /* ============================================================= */

    // Open (or toggle) the step grid for a drum track below the mixer.
    openStepSequencer(trackId) {
      const t = this.tracks.find((x) => x.id === trackId);
      if (!t || !isDrum(t.instrument)) return;
      if (this.seqTrackId === trackId) { this.closeStepSequencer(); return; }
      this.seqTrackId = trackId;
      if (!t.steps) this._initSteps(t); else this._resizeSteps(t);
      this._renderSequencer();
      this.render(); // refresh row buttons (active state)
    },

    closeStepSequencer() {
      this.seqTrackId = null;
      if (this.seqEl) this.seqEl.innerHTML = "";
    },

    _countActiveSteps(t) {
      if (!t.steps) return 0;
      let n = 0;
      DRUM_VOICES().forEach((v) => {
        const row = t.steps[v.id]; if (!row) return;
        for (let i = 0; i < row.length; i++) if (row[i]) n++;
      });
      return n;
    },

    // Toggle a single cell; live-updates the grid + note count badge.
    toggleStep(trackId, voice, step) {
      const t = this.tracks.find((x) => x.id === trackId);
      if (!t || !t.steps || !t.steps[voice]) return;
      this._snapshot();
      t.steps[voice][step] = !t.steps[voice][step];
      const cell = this.seqEl &&
        this.seqEl.querySelector(`.seq-cell[data-voice="${voice}"][data-step="${step}"]`);
      if (cell) cell.classList.toggle("on", t.steps[voice][step]);
      const el = document.querySelector(`.strk[data-id="${t.id}"] .strk-count`);
      if (el) el.textContent = `${this._countActiveSteps(t)} hits`;
    },

    clearSteps(trackId) {
      const t = this.tracks.find((x) => x.id === trackId);
      if (!t) return;
      this._snapshot();
      this._initSteps(t);
      this._renderSequencer();
      this._refreshCounts();
    },

    // "Basic beat" preset: 4-on-the-floor-ish — kick on 1/5/9/13, snare on
    // 5/13 (the backbeat), closed hat on every other 16th. Sized to bar 1 and
    // repeated across every bar of the loop.
    presetBasicBeat(trackId) {
      const t = this.tracks.find((x) => x.id === trackId);
      if (!t) return;
      this._snapshot();
      this._initSteps(t);
      const n = this.stepCount();
      const has = (v) => t.steps[v];
      for (let i = 0; i < n; i++) {
        const inBar = i % STEPS_PER_BAR;       // 0..15
        if (has("kick") && inBar % 4 === 0) t.steps.kick[i] = true;       // 1,5,9,13
        if (has("snare") && (inBar === 4 || inBar === 12)) t.steps.snare[i] = true; // backbeat
        if (has("closedHat") && inBar % 2 === 0) t.steps.closedHat[i] = true;       // every other
      }
      this._renderSequencer();
      this._refreshCounts();
      this.app.toast("Basic beat loaded — hit ▶ Play");
    },

    // Render the grid for the currently open drum track into #studio-seq.
    _renderSequencer() {
      const host = this.seqEl;
      if (!host) return;
      const t = this.tracks.find((x) => x.id === this.seqTrackId);
      if (!t || !isDrum(t.instrument)) { host.innerHTML = ""; return; }
      const n = this.stepCount();
      const kit = kitFor(t.instrument) === "acoustic" ? "Acoustic" : "Electronic";

      const head =
        `<div class="seq-head">
           <span class="seq-title">▦ Steps — <b>${t.name}</b> <span class="seq-kit">${kit} kit</span></span>
           <span class="seq-actions">
             <button class="btn seq-preset">Basic beat</button>
             <button class="btn seq-clear">Clear grid</button>
             <button class="btn seq-close">✕ Close</button>
           </span>
         </div>`;

      let rows = "";
      DRUM_VOICES().forEach((v) => {
        const row = (t.steps && t.steps[v.id]) || [];
        let cells = "";
        for (let i = 0; i < n; i++) {
          const on = row[i] ? " on" : "";
          const beat = (i % 4 === 0) ? " seq-beat" : "";
          const bar = (i % STEPS_PER_BAR === 0 && i !== 0) ? " seq-barline" : "";
          cells +=
            `<button class="seq-cell${on}${beat}${bar}" data-voice="${v.id}" data-step="${i}"
               style="--vc:${t.color}" title="${v.label} · step ${i + 1}"></button>`;
        }
        rows +=
          `<div class="seq-row">
             <span class="seq-label" title="${v.label}">${v.short}</span>
             <div class="seq-cells">${cells}</div>
           </div>`;
      });

      host.innerHTML =
        `<div class="seq glass" style="--cols:${n}">${head}<div class="seq-grid">${rows}</div></div>`;

      // wire cells + actions
      host.querySelectorAll(".seq-cell").forEach((cell) => {
        cell.addEventListener("click", () =>
          this.toggleStep(t.id, cell.dataset.voice, +cell.dataset.step));
      });
      const presetBtn = host.querySelector(".seq-preset");
      if (presetBtn) presetBtn.addEventListener("click", () => this.presetBasicBeat(t.id));
      const clearBtn = host.querySelector(".seq-clear");
      if (clearBtn) clearBtn.addEventListener("click", () => this.clearSteps(t.id));
      const closeBtn = host.querySelector(".seq-close");
      if (closeBtn) closeBtn.addEventListener("click", () => { this.closeStepSequencer(); this.render(); });
    },

    // Move the playhead highlight to `step` (called from the seq callback).
    _highlightStep(step) {
      const host = this.seqEl;
      if (!host) return;
      const prev = host.querySelectorAll(".seq-cell.playhead");
      prev.forEach((c) => c.classList.remove("playhead"));
      if (!this.playing) return;
      host.querySelectorAll(`.seq-cell[data-step="${step}"]`)
        .forEach((c) => c.classList.add("playhead"));
    },

    /* ============================================================= */
    /*  Render                                                       */
    /* ============================================================= */
    _refreshCounts() {
      this.tracks.forEach((t) => {
        const el = document.querySelector(`.strk[data-id="${t.id}"] .strk-count`);
        if (!el) return;
        el.textContent = isDrum(t.instrument)
          ? `${this._countActiveSteps(t)} hits`
          : `${t.events.length} notes`;
      });
    },

    render() {
      const c = this.listEl;
      if (!c) return;
      if (this.addBtn) this.addBtn.disabled = this.tracks.length >= MAX_TRACKS;

      c.innerHTML = "";
      if (!this.tracks.length) {
        c.innerHTML = `<p class="muted">No tracks yet. Hit <b>+ Add track</b>, pick an instrument and
          <b>arm ●</b> it, then press <b>● Record</b> (Q). A 1-bar count-in clicks, then play the
          Piano / Guitar boards to lay down a loop. Add more tracks and overdub.</p>`;
      } else {
        this.tracks.forEach((t) => c.appendChild(this._trackRow(t)));
      }

      // hook: arrangement canvas redraw (no-op until that stage)
      this.renderArrangement();
    },

    _trackRow(t) {
      const anySolo = this.tracks.some((x) => x.soloed);
      const dimmed = anySolo && !t.soloed;
      const selected = this._selTracks.includes(t.id);
      const row = document.createElement("div");
      row.className = "strk glass" + (dimmed ? " strk-dim" : "") + (selected ? " strk-sel" : "");
      row.dataset.id = t.id;

      const opts = INSTRUMENTS.map((i) =>
        `<option value="${i.id}" ${i.id === t.instrument ? "selected" : ""}>${i.label}</option>`).join("");

      const drum = isDrum(t.instrument);
      const countTxt = drum ? `${this._countActiveSteps(t)} hits` : `${t.events.length} notes`;
      const stepsBtn = drum
        ? `<button class="strk-steps ${this.seqTrackId === t.id ? "on" : ""}" title="Step sequencer">▦ Steps</button>`
        : "";

      row.innerHTML = `
        <span class="strk-dot" style="background:${t.color}; color:${t.color}"></span>
        <input class="strk-name" type="text" value="${t.name}" spellcheck="false" />
        <select class="strk-inst">${opts}</select>
        ${stepsBtn}
        <button class="strk-arm ${t.armed ? "on" : ""}" title="Record-arm">●</button>
        <button class="strk-solo ${t.soloed ? "on" : ""}" title="Solo">S</button>
        <button class="strk-mute ${t.muted ? "on" : ""}" title="Mute">M</button>
        <label class="strk-vol" title="Volume">
          <input type="range" min="0" max="100" value="${Math.round(t.volume * 100)}" />
        </label>
        <span class="strk-count">${countTxt}</span>
        <button class="strk-del" title="Delete track">✕</button>`;

      row.querySelector(".strk-name").addEventListener("change", (e) => this.setTrackName(t.id, e.target.value));
      row.querySelector(".strk-inst").addEventListener("change", (e) => this.setTrackInstrument(t.id, e.target.value));
      const stepsEl = row.querySelector(".strk-steps");
      if (stepsEl) stepsEl.addEventListener("click", () => this.openStepSequencer(t.id));
      row.querySelector(".strk-arm").addEventListener("click", () => this.toggleArm(t.id));
      row.querySelector(".strk-solo").addEventListener("click", () => this.toggleSolo(t.id));
      row.querySelector(".strk-mute").addEventListener("click", () => this.toggleMute(t.id));
      const volEl = row.querySelector(".strk-vol input");
      volEl.addEventListener("input", (e) => this.setTrackVolume(t.id, +e.target.value / 100));
      volEl.addEventListener("change", () => this._volSnapshot());
      row.querySelector(".strk-del").addEventListener("click", () => this.removeTrack(t.id));

      // click the row body (not its controls) to select the track
      row.addEventListener("mousedown", (e) => {
        if (e.target.closest("input, select, button, .strk-vol")) return;
        this.selectTrack(t.id, e.shiftKey);
      });
      return row;
    },
  };

  root.Looper = Looper;
  root.Studio = Looper; // alias for the new name; both reach the same object
})(typeof window !== "undefined" ? window : globalThis);
