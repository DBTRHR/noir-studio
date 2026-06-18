/* =====================================================================
   NOIR Studio — Looper / Multi-track recorder
   Record live piano/guitar takes, overdub layered loops, mute/delete
   tracks. Built on Tone.Transport + Tone.Part for sample-accurate loops.
   ===================================================================== */
(function (root) {
  "use strict";

  const COLORS = ["#e10600", "#ff5252", "#ff8f00", "#00e5ff", "#7c4dff", "#00e676", "#ff4081", "#ffd740"];

  const Looper = {
    app: null,
    tracks: [],          // {id, name, events, muted, color, part}
    recording: false,
    playing: false,
    bpm: 100,
    bars: 2,
    quantize: true,
    metronome: false,
    _recEvents: [],
    _nextId: 1,
    _metroLoop: null,
    _metroSynth: null,

    loopLength() { return this.bars * 4 * (60 / this.bpm); }, // seconds (4/4)

    mount(app) {
      this.app = app;
      this.listEl = document.getElementById("looper-tracks");
      this.recBtn = document.getElementById("loop-rec");
      this.playBtn = document.getElementById("loop-play");
      this.dock = document.getElementById("looper-dock");
      this.countEl = document.getElementById("dock-count");
      const toggle = document.getElementById("dock-toggle");
      if (toggle) toggle.addEventListener("click", () => this.dock.classList.toggle("open"));

      this.recBtn.addEventListener("click", () => this.toggleRecord());
      this.playBtn.addEventListener("click", () => this.togglePlay());
      document.getElementById("loop-clear").addEventListener("click", () => this.clearAll());

      const bpm = document.getElementById("loop-bpm");
      bpm.addEventListener("input", () => {
        this.bpm = +bpm.value; document.getElementById("loop-bpm-val").textContent = this.bpm;
        if (root.Tone) Tone.Transport.bpm.value = this.bpm;
        this._applyLoopLength();
      });
      const bars = document.getElementById("loop-bars");
      bars.addEventListener("change", () => { this.bars = +bars.value; this._applyLoopLength(); });
      const q = document.getElementById("loop-quantize");
      q.addEventListener("change", () => { this.quantize = q.checked; });
      const m = document.getElementById("loop-metro");
      m.addEventListener("change", () => { this.metronome = m.checked; this._setupMetro(); });

      this.render();
    },

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
    },

    // Called by app.noteHit when armed
    recordNote(note, instrument) {
      if (!this.recording || !root.Tone) return;
      let time = Tone.Transport.seconds % this.loopLength();
      if (this.quantize) {
        const six = (60 / this.bpm) / 4;
        time = Math.round(time / six) * six;
        if (time >= this.loopLength()) time = 0;
      }
      this._recEvents.push({ time, note, dur: (60 / this.bpm) / 2, instrument });
    },

    async toggleRecord() {
      await this.app.startAudio();
      this._ensureTransport();
      if (!this.recording) {
        this.recording = true;
        this._recEvents = [];
        this.recBtn.classList.add("armed");
        this.recBtn.textContent = "● Recording…";
        if (!this.playing) this.togglePlay();
        this.app.toast("Recording — play the instrument");
      } else {
        this.recording = false;
        this.recBtn.classList.remove("armed");
        this.recBtn.textContent = "● Record";
        if (this._recEvents.length) {
          const name = `Take ${this.tracks.length + 1} · ${this._recEvents[0].instrument}`;
          this.addTrack(name, this._recEvents.slice(), this.loopLength());
        }
        this._recEvents = [];
      }
    },

    addTrack(name, events, srcLoopLen) {
      if (!root.Tone) return;
      this._ensureTransport();
      // If incoming loop length differs, just place events as-is (clamped)
      const L = this.loopLength();
      const id = this._nextId++;
      const color = COLORS[(id - 1) % COLORS.length];
      const evs = events.map((e) => ({ ...e, time: Math.min(e.time, L - 0.001) }));
      const part = new Tone.Part((time, ev) => {
        const tr = this.tracks.find((t) => t.id === id);
        if (tr && tr.muted) return;
        AudioEngine.play(ev.note, ev.dur, 0.82, time, ev.instrument);
        Tone.Draw.schedule(() => this.app.flashNote(ev.note), time);
      }, evs.map((e) => [e.time, e]));
      part.loop = true;
      part.loopEnd = L;
      part.start(0);

      const track = { id, name, events: evs, muted: false, color, part };
      this.tracks.push(track);
      this.render();
      if (!this.playing) this.togglePlay();
    },

    async togglePlay() {
      await this.app.startAudio();
      this._ensureTransport();
      if (this.playing) {
        Tone.Transport.pause();
        this.playing = false;
        this.playBtn.textContent = "▶ Play";
        this.playBtn.classList.remove("active");
      } else {
        Tone.Transport.start();
        this.playing = true;
        this.playBtn.textContent = "❚❚ Pause";
        this.playBtn.classList.add("active");
      }
    },

    _setupMetro() {
      if (!root.Tone) return;
      if (this.metronome) {
        if (!this._metroSynth) this._metroSynth = new Tone.MembraneSynth({ volume: -12 }).toDestination();
        if (!this._metroLoop) {
          this._metroLoop = new Tone.Loop((time) => {
            this._metroSynth.triggerAttackRelease("C2", "16n", time);
          }, "4n");
        }
        this._metroLoop.start(0);
      } else if (this._metroLoop) {
        this._metroLoop.stop();
      }
    },

    toggleMute(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) { t.muted = !t.muted; this.render(); }
    },

    removeTrack(id) {
      const i = this.tracks.findIndex((x) => x.id === id);
      if (i < 0) return;
      try { this.tracks[i].part.dispose(); } catch (e) {}
      this.tracks.splice(i, 1);
      this.render();
      if (!this.tracks.length) this.app.toast("All loops cleared");
    },

    clearAll() {
      this.tracks.forEach((t) => { try { t.part.dispose(); } catch (e) {} });
      this.tracks = [];
      if (root.Tone) { Tone.Transport.stop(); Tone.Transport.position = 0; }
      this.playing = false;
      this.playBtn.textContent = "▶ Play";
      this.playBtn.classList.remove("active");
      this.render();
    },

    render() {
      const c = this.listEl;
      c.innerHTML = "";
      if (this.countEl) this.countEl.textContent = this.tracks.length;
      if (this.dock && this.tracks.length) this.dock.classList.add("open");
      if (!this.tracks.length) {
        c.innerHTML = `<p class="muted">No loops yet. Hit <b>● Record</b>, play some notes on the piano or guitar, then hit record again to close the loop. Layer as many takes as you like.</p>`;
        return;
      }
      this.tracks.forEach((t) => {
        const row = document.createElement("div");
        row.className = "loop-track glass";
        row.innerHTML = `
          <span class="loop-dot" style="background:${t.color}"></span>
          <span class="loop-name">${t.name}</span>
          <span class="loop-count">${t.events.length} notes</span>
          <button class="loop-mute ${t.muted ? "active" : ""}">${t.muted ? "Muted" : "Mute"}</button>
          <button class="loop-del">✕</button>`;
        row.querySelector(".loop-mute").addEventListener("click", () => this.toggleMute(t.id));
        row.querySelector(".loop-del").addEventListener("click", () => this.removeTrack(t.id));
        c.appendChild(row);
      });
    },
  };

  root.Looper = Looper;
})(typeof window !== "undefined" ? window : globalThis);
