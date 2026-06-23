/* =====================================================================
   NOIR Studio — App controller
   Central state, the Key Lab (key / feeling / song / relative-minor),
   tab navigation, lazy audio boot, and cross-module wiring.
   ===================================================================== */
(function (root) {
  "use strict";

  const App = {
    state: {
      root: "C",
      scale: "major",
      instrument: "piano",      // 'piano' | 'guitar' (which board you're playing)
      guitarSound: "acoustic",  // 'acoustic' | 'electric'
      tuning: NoirData.TUNINGS[0].strings.slice(),
      showLabels: true,         // piano note labels
      showAllFret: false,       // show out-of-scale fret notes faintly
      // Shared mood: "noir" (dark) | "w" (bright/west).
      // Initialised from the persisted theme so the two stay in sync.
      // Generators (Riff, Spark, Mood engine) read this for biasing.
      mood: (localStorage.getItem("noir.theme") || "noir") === "light" ? "w" : "noir",
    },
    rand: Math.random,
    _listeners: {},
    _audioReady: false,
    _audioInitPromise: null,

    /* ---- event bus ---- */
    on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    emit(evt, payload) { (this._listeners[evt] || []).forEach((fn) => fn(payload)); },
    change() { this.emit("change"); this.renderKeyReadout(); },

    /* ---- mood (W / Noir bias) ---- */
    // mood: "noir" | "w"
    // Called by applyTheme() when the theme toggle flips, and can be called
    // directly by any module that wants to change generation bias.
    // Frontend hook: call App.setMood("noir") or App.setMood("w").
    getMood() { return this.state.mood; },
    setMood(mood) {
      const m = mood === "w" ? "w" : "noir";
      if (this.state.mood === m) return;
      this.state.mood = m;
      this.emit("mood", m);
      // Propagate to Mood engine if loaded
      if (root.MoodEngine && MoodEngine.onMoodChange) MoodEngine.onMoodChange(m);
    },

    /* ---- derived theory ---- */
    scaleNoteNames() { return Theory.getScaleNotes(this.state.root, this.state.scale); },
    scalePitchClasses() { return Theory.getScalePitchClasses(this.state.root, this.state.scale); },
    currentSound() { return this.state.instrument === "piano" ? "piano" : this.state.guitarSound; },

    _withOct(name, oct) { return name.replace(/\d+$/, "") + oct; },
    scaleNotesWithOctaves(startOct = 4) {
      const names = this.scaleNoteNames();
      const out = [];
      let oct = startOct, prevPc = -1;
      names.forEach((n, i) => {
        const pc = Theory.noteIndex(n);
        if (i > 0 && pc <= prevPc) oct++;
        out.push(this._withOct(n, oct));
        prevPc = pc;
      });
      out.push(this._withOct(names[0], startOct + 1)); // tonic one octave up
      return out;
    },

    /* ---- mutations ---- */
    setRoot(r) { this.state.root = r; this.change(); this.renderRoots(); },
    setScale(s) { this.state.scale = s; this.change(); this.syncScaleSelect(); },
    setKey(r, s) { this.state.root = r; this.state.scale = s; this.change(); this.renderRoots(); this.syncScaleSelect(); },
    setFeeling(f) { this.setKey(f.root, f.scale); this.toast(`${f.emoji} ${f.label} → ${f.root} ${Theory.SCALES[f.scale].name}`); },
    transpose(semi) {
      const idx = Theory.mod(Theory.noteIndex(this.state.root) + semi, 12);
      this.setRoot(Theory.nameFromIndex(idx, Theory.preferFlat(Theory.SHARP[idx], this.state.scale)));
    },

    /* ---- audio boot ---- */
    async startAudio() {
      if (this._audioReady) return;
      if (this._audioInitPromise) return this._audioInitPromise;
      this._audioInitPromise = (async () => {
        this.showLoader(true, "Waking the studio…");
        await AudioEngine.start();
        AudioEngine.onProgress = (f, name) => this.showLoader(true, `Loading ${name} samples…`, f);
        await AudioEngine.init();
        this._audioReady = true;
        this.showLoader(false);
        if (AudioEngine.usingFallback("piano"))
          this.toast("Samples unavailable — using built-in synth");
      })();
      return this._audioInitPromise;
    },

    /* ---- played-note hooks ---- */
    noteHit(note, instrument) { if (root.Looper) Looper.recordNote(note, instrument); },
    flashNote(note) {
      const sharp = this._toSharp(note);
      if (root.Piano && Piano.flash) Piano.flash(sharp);
      if (root.Guitar && Guitar.flash) Guitar.flash(sharp);
    },
    _toSharp(note) {
      const m = String(note).match(/^([A-G]#?b?)(\d+)?$/);
      if (!m) return note;
      const pc = Theory.noteIndex(m[1]);
      return Theory.SHARP[pc] + (m[2] || "");
    },

    /* ================= UI BUILD ================= */
    init() {
      this.buildRoots();
      this.buildScaleSelect();
      this.buildFeelings();
      this.buildSongSearch();
      this.buildTuning();
      this.buildTabs();
      this.buildToggles();

      // mount feature modules
      Piano.mount(this); Guitar.mount(this); Chords.mount(this);
      Scales.mount(this); Riff.mount(this); Looper.mount(this);

      this.renderKeyReadout();
      this.renderRoots();
      this.syncScaleSelect();
      this._updateDock("piano");
    },

    buildRoots() {
      const c = document.getElementById("root-chips");
      c.innerHTML = "";
      Theory.ALL_ROOTS.forEach((r) => {
        const b = document.createElement("button");
        b.className = "root-chip";
        b.dataset.root = r;
        b.textContent = r;
        b.addEventListener("click", () => this.setRoot(r));
        c.appendChild(b);
      });
    },
    renderRoots() {
      document.querySelectorAll("#root-chips .root-chip").forEach((b) => {
        b.classList.toggle("active", Theory.noteIndex(b.dataset.root) === Theory.noteIndex(this.state.root));
      });
    },

    buildScaleSelect() {
      const sel = document.getElementById("scale-select");
      sel.innerHTML = "";
      Object.entries(Theory.SCALES).forEach(([id, def]) => {
        const o = document.createElement("option");
        o.value = id; o.textContent = def.name;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => this.setScale(sel.value));
    },
    syncScaleSelect() { const sel = document.getElementById("scale-select"); if (sel) sel.value = this.state.scale; },

    buildFeelings() {
      const c = document.getElementById("feeling-grid");
      c.innerHTML = "";
      NoirData.FEELINGS.forEach((f) => {
        const b = document.createElement("button");
        b.className = "feeling-card glass";
        b.innerHTML = `<span class="fe-emoji">${f.emoji}</span><span class="fe-label">${f.label}</span><span class="fe-blurb">${f.blurb}</span>`;
        b.addEventListener("click", () => this.setFeeling(f));
        c.appendChild(b);
      });
    },

    buildSongSearch() {
      const input = document.getElementById("song-search");
      const results = document.getElementById("song-results");
      const render = (list) => {
        results.innerHTML = "";
        list.slice(0, 8).forEach((s) => {
          const item = document.createElement("button");
          item.className = "song-item glass";
          item.innerHTML = `<span class="song-title">${s.title}</span>
            <span class="song-artist">${s.artist}</span>
            <span class="song-key">${s.root} ${Theory.SCALES[s.scale].name.split(" ")[0]}</span>`;
          item.addEventListener("click", () => {
            this.setKey(s.root, s.scale);
            input.value = s.title;
            results.classList.remove("open");
            this.toast(`${s.title} → ${s.root} ${Theory.SCALES[s.scale].name}`);
          });
          results.appendChild(item);
        });
        results.classList.toggle("open", list.length > 0);
      };
      input.addEventListener("focus", () => render(NoirData.SONGS));
      input.addEventListener("input", () => {
        const q = input.value.toLowerCase().trim();
        if (!q) return render(NoirData.SONGS);
        render(NoirData.SONGS.filter((s) =>
          s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)));
      });
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".song-box")) results.classList.remove("open");
      });
    },

    buildTuning() {
      const sel = document.getElementById("tuning-select");
      sel.innerHTML = "";
      NoirData.TUNINGS.forEach((t) => {
        const o = document.createElement("option"); o.value = t.id; o.textContent = t.label;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        const t = NoirData.TUNINGS.find((x) => x.id === sel.value);
        if (t) { this.state.tuning = t.strings.slice(); this.buildTuningStrings(); this.emit("tuning", this.state.tuning); }
      });
      this.buildTuningStrings();
    },
    buildTuningStrings() {
      const c = document.getElementById("tuning-strings");
      c.innerHTML = "";
      // display high -> low for editing convenience
      this.state.tuning.slice().reverse().forEach((openNote, ri) => {
        const realIdx = this.state.tuning.length - 1 - ri;
        const m = openNote.match(/^([A-G]#?b?)(\d)$/);
        const wrap = document.createElement("div");
        wrap.className = "tstring";
        const noteSel = document.createElement("select");
        Theory.ALL_ROOTS.forEach((n) => {
          const o = document.createElement("option"); o.value = n; o.textContent = n;
          if (Theory.noteIndex(n) === Theory.noteIndex(m[1])) o.selected = true;
          noteSel.appendChild(o);
        });
        const octSel = document.createElement("select");
        [1, 2, 3, 4, 5].forEach((oc) => {
          const o = document.createElement("option"); o.value = oc; o.textContent = oc;
          if (oc === +m[2]) o.selected = true;
          octSel.appendChild(o);
        });
        const apply = () => {
          this.state.tuning[realIdx] = noteSel.value + octSel.value;
          document.getElementById("tuning-select").value = "";
          this.emit("tuning", this.state.tuning);
        };
        noteSel.addEventListener("change", apply);
        octSel.addEventListener("change", apply);
        wrap.appendChild(noteSel); wrap.appendChild(octSel);
        c.appendChild(wrap);
      });
    },

    buildToggles() {
      const g = document.getElementById("guitar-sound");
      g.addEventListener("change", () => { this.state.guitarSound = g.value; });
      const lbl = document.getElementById("toggle-labels");
      lbl.addEventListener("change", () => { this.state.showLabels = lbl.checked; this.emit("change"); });
      const all = document.getElementById("toggle-allfret");
      all.addEventListener("change", () => { this.state.showAllFret = all.checked; this.emit("change"); });
      document.getElementById("transpose-down").addEventListener("click", () => this.transpose(-1));
      document.getElementById("transpose-up").addEventListener("click", () => this.transpose(1));
      // relative tool buttons are rendered in renderKeyReadout

      // theme toggle (noir <-> Eastwood light)
      const saved = localStorage.getItem("noir.theme") || "noir";
      this.applyTheme(saved);
      document.getElementById("theme-toggle").addEventListener("click", () => {
        this.applyTheme(document.documentElement.dataset.theme === "light" ? "noir" : "light");
      });

      // delay selects (riff toolbar + guitar bar, kept in sync)
      const delays = [document.getElementById("delay-select"), document.getElementById("delay-select-guitar")].filter(Boolean);
      delays.forEach((sel) => sel.addEventListener("change", () => {
        const v = sel.value;
        delays.forEach((s) => { s.value = v; });
        this.startAudio().then(() => AudioEngine.setDelay(v));
        if (v !== "off") this.toast(`Delay: ${sel.options[sel.selectedIndex].text}`);
      }));
    },

    applyTheme(name) {
      const isLight = name === "light";
      document.documentElement.dataset.theme = isLight ? "light" : "noir";
      localStorage.setItem("noir.theme", document.documentElement.dataset.theme);
      const btn = document.getElementById("theme-toggle");
      // Label shows the world you'll switch TO, so the action is obvious.
      if (btn) btn.textContent = isLight ? "🌙 NOIR" : "☀ WEST";
      // Sync mood bias to theme — "light" (W) = bright, "noir" = dark
      this.setMood(isLight ? "w" : "noir");
    },

    buildTabs() {
      const tabs = document.querySelectorAll("[data-tab]");
      tabs.forEach((t) => t.addEventListener("click", () => {
        const id = t.dataset.tab;
        tabs.forEach((x) => x.classList.toggle("active", x === t));
        document.querySelectorAll("[data-panel]").forEach((p) =>
          p.classList.toggle("active", p.dataset.panel === id));
        if (id === "piano") this.state.instrument = "piano";
        if (id === "guitar") this.state.instrument = "guitar";
        this._updateDock(id);
      }));

      // "🎛️ Studio" shortcut link on the floating transport strip.
      document.querySelectorAll("[data-goto-studio]").forEach((el) =>
        el.addEventListener("click", () => {
          const tab = document.querySelector('[data-tab="studio"]');
          if (tab) tab.click();
        }));
    },
    _updateDock(id) {
      // Slim floating transport: only on the playable boards (Piano/Guitar/Riff).
      // The full multitrack mixer lives on the Studio page itself.
      const x = document.getElementById("xport");
      if (x) x.classList.toggle("visible", ["piano", "guitar", "riff"].includes(id));
    },

    renderKeyReadout() {
      const r = this.state.root, s = this.state.scale;
      const elKey = document.getElementById("current-key");
      if (elKey) elKey.textContent = `${r} ${Theory.SCALES[s].name}`;
      const notesEl = document.getElementById("current-notes");
      if (notesEl) notesEl.textContent = this.scaleNoteNames().join("  ");
      const kc = document.getElementById("kc-key-name");
      if (kc) kc.textContent = `${r} ${Theory.SCALES[s].name.split(" ")[0]}`;

      // relative minor / major tool
      const relEl = document.getElementById("relative-tool");
      if (!relEl) return;
      const isMinorish = ["minor", "harmonicMinor", "melodicMinor", "dorian", "phrygian", "locrian", "minorPentatonic", "blues"].includes(s);
      let html = "";
      if (isMinorish) {
        const relMaj = Theory.relativeMajor(r);
        html = `<span class="rel-label">Relative major</span>
                <button class="rel-btn" data-rel-root="${relMaj}" data-rel-scale="major">${relMaj} Major</button>`;
      } else {
        const relMin = Theory.relativeMinor(r);
        html = `<span class="rel-label">Relative minor</span>
                <button class="rel-btn" data-rel-root="${relMin}" data-rel-scale="minor">${relMin} Minor</button>`;
      }
      // parallel toggle
      const parScale = isMinorish ? "major" : "minor";
      html += `<span class="rel-label">Parallel</span>
               <button class="rel-btn" data-rel-root="${r}" data-rel-scale="${parScale}">${r} ${parScale === "major" ? "Major" : "Minor"}</button>`;
      relEl.innerHTML = html;
      relEl.querySelectorAll(".rel-btn").forEach((b) =>
        b.addEventListener("click", () => this.setKey(b.dataset.relRoot, b.dataset.relScale)));
    },

    /* ---- chrome: loader + toast ---- */
    showLoader(show, label, frac) {
      const el = document.getElementById("loader");
      if (!el) return;
      el.classList.toggle("show", show);
      if (label) document.getElementById("loader-label").textContent = label;
      const bar = document.getElementById("loader-bar");
      if (bar && frac != null) bar.style.width = Math.round(frac * 100) + "%";
      if (!show && bar) bar.style.width = "0%";
    },
    _toastTimer: null,
    toast(msg) {
      const el = document.getElementById("toast");
      if (!el) return;
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
    },
  };

  root.App = App;
  document.addEventListener("DOMContentLoaded", () => App.init());
})(typeof window !== "undefined" ? window : globalThis);
