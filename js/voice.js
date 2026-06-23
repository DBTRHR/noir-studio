/* =====================================================================
   NOIR Studio — METAL DUDE VOICE + COVER ART
   Wires the media assets in assets/voice/ and assets/covers/ into the UI.

   UX rules (per coordinator + INTEGRATION.md): the clips are long (~15–26s)
   and robotic, so playback is UNOBTRUSIVE and USER-CONTROLLED:
     • A speaker toggle near Metal Dude. DEFAULT OFF. Persisted.
     • Clips ONLY play when the user has switched voice ON.
     • Calling metalDudeSay() stops any currently-playing clip first.
     • Any 404 / autoplay-block / missing element fails SILENTLY — never
       throws, never blocks compose or any other action.

   Cover art: an <img id="track-cover"> in the Composer result. Covers may
   not exist yet — the img hides itself on error (onerror → display:none),
   so when covers are later dropped into assets/covers/ they light up with
   no code change.

   This module ONLY wraps app-level modules (Composer, Riff) externally and
   listens to App events. It does NOT modify engine files.
   ===================================================================== */
(function (root) {
  "use strict";

  const STORE_KEY = "noir.voice";   // "on" | "off"  (default off)

  // Mood/vibe → clip. Only these vibes have a dedicated line.
  const MOOD_CLIP = {
    doom:   "metaldude_doom_mode",
    dreamy: "metaldude_dreamy_mode",
    epic:   "metaldude_epic_mode",
  };

  // Mood → cover art (covers may be absent; onerror hides the img).
  const COVER_MAP = {
    noir:       "assets/covers/cover_noir.png",
    west:       "assets/covers/cover_west.png",
    doom:       "assets/covers/cover_doom.png",
    heavy:      "assets/covers/cover_doom.png",
    dreamy:     "assets/covers/cover_dreamy.png",
    ethereal:   "assets/covers/cover_dreamy.png",
    epic:       "assets/covers/cover_epic.png",
    cinematic:  "assets/covers/cover_epic.png",
    melancholy: "assets/covers/cover_melancholy.png",
    sad:        "assets/covers/cover_melancholy.png",
  };

  const Voice = {
    enabled: false,
    audio: null,
    btn: null,
    _greeted: false,
    _coverSet: null,   // Set of cover filenames known to exist (from manifest)

    mount(app) {
      this.app = app;
      try { this.enabled = localStorage.getItem(STORE_KEY) === "on"; } catch (e) { this.enabled = false; }

      this._ensureAudioEl();
      this._buildToggle();
      this._loadCoverManifest();
      this._wireTriggers();
    },

    // Load the cover manifest once. Only covers LISTED here are ever loaded,
    // so absent covers never produce a console 404. The manifest itself exists
    // (ships with the repo), so reading it is a clean 200. On file:// where
    // fetch may fail, we just end up with no covers (graceful).
    _loadCoverManifest() {
      this._coverSet = new Set();
      try {
        if (typeof fetch !== "function") return;
        fetch("assets/covers/manifest.json", { cache: "no-cache" })
          .then((r) => (r && r.ok ? r.json() : null))
          .then((j) => {
            const list = j && Array.isArray(j.available) ? j.available : [];
            this._coverSet = new Set(list);
          })
          .catch(() => { /* stay empty → no covers, no errors */ });
      } catch (e) { /* ignore */ }
    },

    /* ---------- the hidden <audio> + global say() ---------- */
    _ensureAudioEl() {
      let el = document.getElementById("metaldude-voice");
      if (!el) {
        el = document.createElement("audio");
        el.id = "metaldude-voice";
        el.preload = "none";
        // a bad src must never surface as a console error / thrown event
        el.addEventListener("error", (e) => { try { e.stopPropagation(); } catch (x) {} }, true);
        document.body.appendChild(el);
      }
      this.audio = el;
    },

    // Public, guarded. Safe to call from anywhere — does nothing when muted.
    say(clipName) {
      if (!this.enabled) return;              // user-controlled gate
      const el = this.audio || document.getElementById("metaldude-voice");
      if (!el || !clipName) return;
      try {
        el.pause();                            // stop any current clip (no overlap)
        el.currentTime = 0;
        el.volume = 0.7;                       // sit under the music
        el.src = `assets/voice/${clipName}.wav`;
        el.load();
        const p = el.play();
        if (p && p.catch) p.catch(() => {});   // swallow autoplay blocks
      } catch (e) { /* never throw */ }
    },

    stop() {
      const el = this.audio || document.getElementById("metaldude-voice");
      if (!el) return;
      try { el.pause(); el.currentTime = 0; } catch (e) {}
    },

    /* ---------- speaker mute/unmute toggle ---------- */
    _buildToggle() {
      const host = document.getElementById("nathan");
      if (!host || document.getElementById("metaldude-voice-toggle")) return;
      const b = document.createElement("button");
      b.id = "metaldude-voice-toggle";
      b.className = "md-voice-toggle";
      b.type = "button";
      this._paintToggle(b);
      b.addEventListener("click", () => this.toggle());
      // place it just before the avatar so it floats above Metal Dude
      host.insertBefore(b, host.firstChild);
      this.btn = b;
    },

    _paintToggle(b) {
      b = b || this.btn;
      if (!b) return;
      b.classList.toggle("on", this.enabled);
      b.setAttribute("aria-pressed", String(this.enabled));
      b.title = this.enabled
        ? "Metal Dude voice: ON (click to mute — clips are long)"
        : "Metal Dude voice: OFF (click to let Metal Dude talk)";
      b.textContent = this.enabled ? "🔊" : "🔇";
    },

    toggle() {
      this.enabled = !this.enabled;
      try { localStorage.setItem(STORE_KEY, this.enabled ? "on" : "off"); } catch (e) {}
      this._paintToggle();
      if (this.enabled) {
        if (this.app && this.app.toast) this.app.toast("🔊 Metal Dude voice on");
        // first enable doubles as the user gesture → safe to greet once
        if (!this._greeted) { this._greeted = true; this.say("metaldude_greeting"); }
      } else {
        this.stop();
        if (this.app && this.app.toast) this.app.toast("🔇 Metal Dude voice off");
      }
    },

    /* ---------- cover art (graceful fallback) ----------
       Covers may not exist yet. We PROBE the file first (fetch HEAD) and only
       set img.src when it's actually there — this keeps the browser console
       clean (no 404 for a missing <img src>). img.onerror is still wired as a
       belt-and-braces fallback. On file:// (where fetch can't HEAD a local
       file) the probe fails → we simply leave the cover hidden, which is the
       intended graceful degradation. The moment real covers land in
       assets/covers/, they light up with no code change. */
    showCover(mood) {
      const img = document.getElementById("track-cover");
      if (!img) return;
      const themeMood = this.app && this.app.getMood && this.app.getMood() === "w" ? "west" : "noir";
      const src = COVER_MAP[mood] || COVER_MAP[themeMood] || COVER_MAP.noir;
      const file = src.split("/").pop();
      img.style.display = "none";
      img.onerror = () => { img.style.display = "none"; };  // belt-and-braces
      img.onload  = () => { img.style.display = "block"; };
      // Only load covers the manifest says exist → zero console 404s for the
      // (currently empty) cover set. When real covers are added to the folder
      // AND listed in assets/covers/manifest.json, they appear automatically.
      if (this._coverSet && this._coverSet.has(file)) {
        img.src = src;
      }
    },

    /* ---------- trigger wiring (wrap app modules, not engine files) ---------- */
    _wireTriggers() {
      const self = this;

      // Greeting on first time the Metal Dude chat is opened (a real gesture).
      const avatar = document.getElementById("nathan-avatar");
      if (avatar) {
        avatar.addEventListener("click", () => {
          if (!self._greeted) { self._greeted = true; self.say("metaldude_greeting"); }
        });
      }

      // Composer hooks — wrap selectMood / compose / renderSong if present.
      const tryWireComposer = () => {
        const C = root.Composer;
        if (!C || C._voiceWired) return !!C;
        C._voiceWired = true;

        // vibe selection → mode line for doom/dreamy/epic
        const _select = C.selectMood && C.selectMood.bind(C);
        if (_select) C.selectMood = function (name) {
          _select(name);
          if (MOOD_CLIP[name]) self.say(MOOD_CLIP[name]);
        };

        // compose pressed → theme-aware start line
        const _compose = C.compose && C.compose.bind(C);
        if (_compose) C.compose = function () {
          const isWest = self.app && self.app.getMood && self.app.getMood() === "w";
          self.say(isWest ? "metaldude_compose_start_west" : "metaldude_compose_start_noir");
          _compose();
        };

        // song rendered → complete line + cover art
        const _render = C.renderSong && C.renderSong.bind(C);
        if (_render) C.renderSong = function (song) {
          _render(song);
          self._injectCover();
          self.showCover(C.mood);
          self.say("metaldude_compose_complete");
        };
        return true;
      };

      // Riff play → "nice riff" (wrap togglePlay once it exists).
      const tryWireRiff = () => {
        const R = root.Riff;
        if (!R || R._voiceWired) return !!R;
        R._voiceWired = true;
        const _toggle = R.togglePlay && R.togglePlay.bind(R);
        if (_toggle) R.togglePlay = function () {
          const wasPlaying = R.playing;
          _toggle();
          // only speak when we just STARTED playing (not on stop)
          if (!wasPlaying && R.playing) self.say("metaldude_nice_riff");
        };
        return true;
      };

      // Modules mount on DOMContentLoaded too; retry briefly until present.
      let tries = 0;
      const iv = setInterval(() => {
        const okC = tryWireComposer();
        const okR = tryWireRiff();
        if ((okC && okR) || ++tries > 40) clearInterval(iv);
      }, 50);
    },

    // Insert the cover <img> into the composed-song card if not already there.
    _injectCover() {
      const result = document.getElementById("composer-result");
      if (!result) return;
      if (document.getElementById("track-cover")) return;
      const card = result.querySelector(".composer-song") || result;
      const img = document.createElement("img");
      img.id = "track-cover";
      img.className = "track-cover";
      img.alt = "Track cover art";
      img.style.display = "none";
      // place at the top of the card
      card.insertBefore(img, card.firstChild);
    },
  };

  // expose the utility globally exactly as INTEGRATION.md describes
  root.metalDudeSay = function (clip) { Voice.say(clip); };
  root.MetalVoice = Voice;

  document.addEventListener("DOMContentLoaded", () => {
    if (root.App) Voice.mount(root.App);
  });
})(typeof window !== "undefined" ? window : globalThis);
