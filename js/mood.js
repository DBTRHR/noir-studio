/* =====================================================================
   NOIR Studio — Mood / Intent Engine
   Pure functions, no DOM, no audio.  Safe to Node-test.

   Core exports (all on window.MoodEngine):
     moodToMusic(mood)           → recipe object (key/scale/tempo/groove/…)
     composeSong(opts)           → full song skeleton
     suggestProgression(mood)    → chord array (same shape as Theory.diatonicChords)
     suggestRiff(mood)           → note array  (same shape as Riff.riff)
     suggestDrums(mood)          → 16-step pattern object
     onMoodChange(mood)          → called by App.setMood(); propagates to active
                                   generators.

   Emotion/scene table (MOOD_TABLE) is the single tunable lookup.
   Research-pass: edit the table entries; algorithm stays the same.

   Dependencies (globals expected at call time, not at parse time):
     Theory — js/theory.js
     Riff   — js/riff.js  (for suggestRiff only)
   ===================================================================== */
(function (root) {
  "use strict";

  // -----------------------------------------------------------------------
  // MOOD_TABLE
  // Each entry maps a mood/scene keyword → music recipe.
  // TUNABLE: update numbers; algorithm stays the same.
  //
  // Fields (all optional; _recipe() fills defaults):
  //   key          – preferred root note
  //   scale        – Theory.SCALES key
  //   tempoRange   – [min, max] BPM
  //   groove       – Theory.GROOVE_PRESETS key
  //   progressionStyle – Theory.PROG_LIBRARY key
  //   octaveRange  – riff octave span (1-3)
  //   chordStyle   – "triads" | "7ths" | "9ths" | "add9"
  //   energy       – 1..10 (dynamics/density hint for frontend)
  //   register     – "low" | "mid" | "high" (riff generator bias)
  //   dynamics     – "p" | "mp" | "mf" | "f" | "ff" (metadata)
  //   articulation – "legato" | "staccato" | "marcato" | "rubato" (metadata)
  //   contour      – "arch" | "ascending" | "descending" | "held-develop-return"
  //   intervalPalette – dominant interval types the riff should prefer
  //   density      – "sparse" | "medium" | "dense" (rest ratio hint)
  //   genrePreset  – key into Theory.GENRE_PRESETS for extra overrides
  //   sceneDevices – array of string hints for arrangers (ostinato, pedal, silence…)
  //   emphasizedDegrees – degree indices (0-based) to weight in note pool
  //   tags         – aliases the matcher also searches
  //
  // Source: research-codify-intentional-composition.md § emotion -> params
  // -----------------------------------------------------------------------
  const MOOD_TABLE = {
    happy: {
      key: "C", scale: "major", tempoRange: [110, 140], groove: "funk",
      progressionStyle: "pop", octaveRange: 2, chordStyle: "triads", energy: 7,
      register: "mid", dynamics: "mf", articulation: "staccato",
      contour: "arch", intervalPalette: "M3+M6+P4+P5", density: "dense",
      emphasizedDegrees: [2],  // major 3rd — bright
      tags: ["joyful","upbeat","bright","cheerful","fun","uplifting"],
    },
    sad: {
      key: "A", scale: "minor", tempoRange: [50, 75], groove: "blues",
      progressionStyle: "metal", octaveRange: 2, chordStyle: "7ths", energy: 3,
      register: "low", dynamics: "p", articulation: "legato",
      contour: "descending", intervalPalette: "m2+m3", density: "sparse",
      emphasizedDegrees: [2, 5],  // b3 & b6 (Aeolian)
      tags: ["melancholy","blue","heartbreak","grief","wistful","sorrowful","lonely"],
    },
    melancholy: {
      key: "E", scale: "dorian", tempoRange: [60, 80], groove: "blues",
      progressionStyle: "dorian", octaveRange: 2, chordStyle: "7ths", energy: 4,
      register: "low", dynamics: "mp", articulation: "legato",
      contour: "descending", intervalPalette: "m3+m6", density: "sparse",
      emphasizedDegrees: [5],  // nat6 (Dorian's hopeful color)
      tags: ["bittersweet","yearning","nostalgic","longing","wistful"],
    },
    tense: {
      key: "D", scale: "harmonicMinor", tempoRange: [90, 140], groove: "metal",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 8,
      register: "mid", dynamics: "f", articulation: "staccato",
      contour: "arch", intervalPalette: "m2+tritone", density: "dense",
      emphasizedDegrees: [5, 6],  // nat7 over b6 (harmonic minor tension)
      sceneDevices: ["irregular-rhythm","tritone","resolution-withheld"],
      tags: ["suspense","nervous","anxious","uneasy","thriller","conflict","suspense"],
    },
    peaceful: {
      key: "G", scale: "majorPentatonic", tempoRange: [50, 80], groove: "bossa",
      progressionStyle: "pop", octaveRange: 2, chordStyle: "9ths", energy: 3,
      register: "mid", dynamics: "pp", articulation: "legato",
      contour: "arch", intervalPalette: "P4+P5+M2", density: "sparse",
      emphasizedDegrees: [],  // pentatonic — all open
      sceneDevices: ["slow-harmonic-rhythm","sparse","gentle-rubato"],
      tags: ["calm","serene","tranquil","relaxed","chill","soothing","gentle","quiet"],
    },
    eerie: {
      key: "B", scale: "locrian", tempoRange: [55, 80], groove: "hiphop",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 5,
      register: "low", dynamics: "p", articulation: "legato",
      contour: "descending", intervalPalette: "m2+tritone+m7", density: "sparse",
      emphasizedDegrees: [4],  // b5 (Locrian tritone — use sparingly)
      sceneDevices: ["silence","irregular-rhythm","extreme-register","dim7-cluster"],
      tags: ["unsettling","strange","weird","uncanny","sinister","creepy"],
    },
    aggressive: {
      key: "E", scale: "phrygian", tempoRange: [130, 180], groove: "metal",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 10,
      register: "low", dynamics: "ff", articulation: "marcato",
      contour: "descending", intervalPalette: "m2+tritone+P5", density: "dense",
      emphasizedDegrees: [1],  // b2 (Phrygian signature)
      genrePreset: "metalcore-dark",
      sceneDevices: ["driving-groove","palm-mute","power-chords","b2-accent"],
      tags: ["angry","furious","rage","hostile","violent","brutal","intense","metal","metalcore"],
    },
    epic: {
      key: "D", scale: "mixolydian", tempoRange: [100, 140], groove: "rock",
      progressionStyle: "pop", octaveRange: 3, chordStyle: "7ths", energy: 9,
      register: "high", dynamics: "ff", articulation: "marcato",
      contour: "ascending", intervalPalette: "P4+P5+M6", density: "dense",
      emphasizedDegrees: [6],  // b7 (Mixolydian's rebellious/anthemic color)
      sceneDevices: ["ostinato","build","fanfare","dotted-rhythm"],
      tags: ["heroic","cinematic","triumphant","grand","majestic","powerful"],
    },
    dreamy: {
      key: "C", scale: "lydian", tempoRange: [70, 100], groove: "neo-soul",
      progressionStyle: "neo-soul", octaveRange: 2, chordStyle: "9ths", energy: 4,
      register: "high", dynamics: "mp", articulation: "legato",
      contour: "arch", intervalPalette: "#4+M2+M7", density: "sparse",
      emphasizedDegrees: [3],  // #4 (Lydian — floating, magical)
      sceneDevices: ["slow-harmonic-rhythm","pad","reverb","sus2-sus4"],
      tags: ["ethereal","floating","magical","wonder","fantasy","otherworldly"],
    },
    dark: {
      key: "E", scale: "phrygianDominant", tempoRange: [60, 90], groove: "metalcore-dark",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 7,
      register: "low", dynamics: "f", articulation: "marcato",
      contour: "descending", intervalPalette: "m2+M3+tritone", density: "medium",
      emphasizedDegrees: [1, 2],  // b2 + major3 (Phrygian-dominant sinister/Eastern)
      genrePreset: "metalcore-dark",
      sceneDevices: ["pedal-tone","b2-accent","tritone-accent","drone"],
      tags: ["ominous","foreboding","menacing","evil","sinister","noir","gothic","dark-metal"],
    },
    romantic: {
      key: "F", scale: "major", tempoRange: [60, 85], groove: "bossa",
      progressionStyle: "jazz", octaveRange: 2, chordStyle: "9ths", energy: 5,
      register: "mid", dynamics: "mp", articulation: "rubato",
      contour: "arch", intervalPalette: "M3+M6+m3", density: "medium",
      emphasizedDegrees: [2],  // 3rd (Ionian warmth)
      sceneDevices: ["leitmotif","legato","secondary-dominant","maj7-ext"],
      tags: ["love","tender","intimate","warm","sweet","affectionate"],
    },
    hopeful: {
      key: "G", scale: "major", tempoRange: [90, 120], groove: "rock",
      progressionStyle: "pop", octaveRange: 2, chordStyle: "triads", energy: 6,
      register: "mid", dynamics: "mf", articulation: "legato",
      contour: "ascending", intervalPalette: "P4+P5+M6", density: "medium",
      emphasizedDegrees: [2],  // 3rd (Ionian major brightness)
      tags: ["optimistic","inspired","rising","determined","encouraging"],
    },
    groovy: {
      key: "D", scale: "dorian", tempoRange: [95, 130], groove: "funk",
      progressionStyle: "dorian", octaveRange: 2, chordStyle: "7ths", energy: 8,
      register: "mid", dynamics: "f", articulation: "staccato",
      contour: "arch", intervalPalette: "m3+P4+m7", density: "dense",
      emphasizedDegrees: [5],  // nat6 (Dorian groove/soul color)
      sceneDevices: ["ghost-notes","call-response","beat1-emphasis","16th-grid"],
      tags: ["funky","rhythmic","soul","r&b","bounce","pocket","neo-soul","smooth"],
    },
    // ---- Additional moods from research lookup ----
    nostalgic: {
      key: "C", scale: "major", tempoRange: [70, 100], groove: "rock",
      progressionStyle: "pop", octaveRange: 2, chordStyle: "7ths", energy: 5,
      register: "mid", dynamics: "mp", articulation: "legato",
      contour: "descending", intervalPalette: "m3+M6", density: "medium",
      emphasizedDegrees: [2],
      sceneDevices: ["modal-interchange","bVI","bVII","warm-timbre"],
      tags: ["longing","memory","vintage","retro","warm","bittersweet"],
    },
    doom: {
      key: "E", scale: "phrygian", tempoRange: [40, 70], groove: "doom",
      progressionStyle: "metal", octaveRange: 1, chordStyle: "triads", energy: 6,
      register: "low", dynamics: "f", articulation: "legato",
      contour: "descending", intervalPalette: "m2+m3+P5", density: "sparse",
      emphasizedDegrees: [1],  // b2 (Phrygian heaviness)
      genrePreset: "doom",
      sceneDevices: ["pedal-tone","hypnotic-repeat","long-sustain","soft-to-thunderous"],
      tags: ["heavy","crushing","sludge","slow","suffocating","funeral"],
    },
    // ---- Scene presets ----
    chase: {
      key: "D", scale: "minor", tempoRange: [140, 180], groove: "metalcore-dark",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 10,
      register: "mid", dynamics: "ff", articulation: "marcato",
      contour: "ascending", intervalPalette: "m2+tritone+P5", density: "dense",
      emphasizedDegrees: [2, 5],  // b3 & b6 (Aeolian urgency)
      sceneDevices: ["ostinato","driving-drums","odd-meter","m2-cluster"],
      tags: ["action","pursuit","escape","run","fast","frantic"],
    },
    horror: {
      key: "B", scale: "harmonicMinor", tempoRange: [50, 75], groove: "doom",
      progressionStyle: "metal", octaveRange: 3, chordStyle: "triads", energy: 6,
      register: "low", dynamics: "p", articulation: "legato",
      contour: "descending", intervalPalette: "m2+tritone+aug2", density: "sparse",
      emphasizedDegrees: [5, 6],  // nat7 over b6 (harmonic minor dread)
      sceneDevices: ["silence-before-hit","sudden-accent","tritone","cluster"],
      tags: ["scary","fear","terror","fright","monster","nightmare","horror-reveal"],
    },
    suspense: {
      key: "D", scale: "harmonicMinor", tempoRange: [60, 100], groove: "hiphop",
      progressionStyle: "metal", octaveRange: 2, chordStyle: "triads", energy: 7,
      register: "mid", dynamics: "mp", articulation: "staccato",
      contour: "arch", intervalPalette: "m2+tritone", density: "medium",
      emphasizedDegrees: [5, 6],
      sceneDevices: ["pedal-point","layered-ostinato","resolution-withheld","long-crescendo"],
      tags: ["thriller","tension","waiting","dread","build","unresolved"],
    },
    sunrise: {
      key: "C", scale: "lydian", tempoRange: [65, 90], groove: "bossa",
      progressionStyle: "pop", octaveRange: 2, chordStyle: "add9", energy: 4,
      register: "high", dynamics: "mp", articulation: "legato",
      contour: "ascending", intervalPalette: "#4+M2+P5", density: "sparse",
      emphasizedDegrees: [3],  // #4 (Lydian shimmer/awe)
      sceneDevices: ["density-build","rising-to-high-shimmer","sus-chords"],
      tags: ["dawn","morning","awakening","awe","birth","beginning","fresh"],
    },
    victory: {
      key: "G", scale: "mixolydian", tempoRange: [110, 150], groove: "rock",
      progressionStyle: "pop", octaveRange: 3, chordStyle: "triads", energy: 9,
      register: "high", dynamics: "ff", articulation: "marcato",
      contour: "ascending", intervalPalette: "P4+P5+M6", density: "dense",
      emphasizedDegrees: [6],  // b7 (Mixolydian triumphant)
      sceneDevices: ["fanfare","dotted-rhythm","major","bVII-IV"],
      tags: ["triumph","win","champion","glory","achievement","climax"],
    },
    grief: {
      key: "A", scale: "minor", tempoRange: [45, 70], groove: "blues",
      progressionStyle: "metal", octaveRange: 1, chordStyle: "7ths", energy: 2,
      register: "low", dynamics: "p", articulation: "legato",
      contour: "descending", intervalPalette: "m2+m3", density: "sparse",
      emphasizedDegrees: [2, 5],  // b3 & b6
      sceneDevices: ["minor-plagal","descending-contour","solo-exposed","silence"],
      tags: ["loss","mourning","grief","sorrow","weeping","funeral","loss-scene"],
    },
    "love-scene": {
      key: "F", scale: "major", tempoRange: [60, 85], groove: "bossa",
      progressionStyle: "jazz", octaveRange: 2, chordStyle: "9ths", energy: 5,
      register: "mid", dynamics: "mp", articulation: "rubato",
      contour: "arch", intervalPalette: "M3+M6+M7", density: "medium",
      emphasizedDegrees: [2],
      sceneDevices: ["leitmotif","strings+piano","imaj7-vi-ii-V","secondary-dominant"],
      tags: ["romance","love","tender","cinematic-love","intimate-scene"],
    },
  };

  // -----------------------------------------------------------------------
  // _match: find the best MOOD_TABLE entry for a free-text mood string.
  // Direct key match first; then searches tags for the closest word overlap.
  // -----------------------------------------------------------------------
  function _match(moodStr) {
    if (!moodStr) return MOOD_TABLE.happy;
    const q = String(moodStr).toLowerCase().trim();
    // Direct key
    if (MOOD_TABLE[q]) return MOOD_TABLE[q];
    // Tag search
    let best = null, bestScore = 0;
    Object.values(MOOD_TABLE).forEach((entry) => {
      const tags = (entry.tags || []);
      let score = 0;
      tags.forEach((tag) => {
        if (q.includes(tag) || tag.includes(q)) score++;
      });
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    return best || MOOD_TABLE.happy;
  }

  // -----------------------------------------------------------------------
  // _recipe: fill in defaults for a matched table entry.
  // Skips undefined override values so callers can safely pass
  // { key: opts.key || undefined } without clobbering the table default.
  // -----------------------------------------------------------------------
  function _recipe(entry, overrides) {
    const base = {
      key:               "C",
      scale:             "major",
      tempoRange:        [90, 120],
      groove:            "rock",
      progressionStyle:  "pop",
      octaveRange:       2,
      chordStyle:        "triads",
      energy:            5,
    };
    const merged = Object.assign({}, base, entry);
    if (overrides) {
      Object.keys(overrides).forEach((k) => {
        if (overrides[k] !== undefined) merged[k] = overrides[k];
      });
    }
    return merged;
  }

  // -----------------------------------------------------------------------
  // moodToMusic(moodOrScene, overrides?)
  // Returns a full recipe object with all research-pass fields.
  // tempo is a single BPM chosen randomly within tempoRange.
  // All fields are overridable via the overrides argument.
  // -----------------------------------------------------------------------
  function moodToMusic(moodOrScene, overrides) {
    const entry  = _match(moodOrScene);
    const recipe = _recipe(entry, overrides);
    const [tMin, tMax] = recipe.tempoRange;
    const tempo  = Math.round(tMin + Math.random() * (tMax - tMin));
    const T      = root.Theory;
    const scaleDef = T && T.SCALES && T.SCALES[recipe.scale];
    // Merge emphasized degrees from Theory if not set in table
    const emphDegrees = recipe.emphasizedDegrees !== undefined
      ? recipe.emphasizedDegrees
      : (T && T.EMPHASIZED_DEGREES && T.EMPHASIZED_DEGREES[recipe.scale]) || [];
    return {
      moodName:          moodOrScene || "happy",
      key:               recipe.key,
      scale:             recipe.scale,
      scaleName:         scaleDef ? scaleDef.name : recipe.scale,
      tempo,
      tempoRange:        recipe.tempoRange,
      groove:            recipe.groove,
      progressionStyle:  recipe.progressionStyle,
      octaveRange:       recipe.octaveRange,
      chordStyle:        recipe.chordStyle,
      energy:            recipe.energy,
      // Research-pass fields (all metadata for frontend + generator use)
      register:          recipe.register     || "mid",
      dynamics:          recipe.dynamics     || "mf",
      articulation:      recipe.articulation || "legato",
      contour:           recipe.contour      || "arch",
      intervalPalette:   recipe.intervalPalette || "",
      density:           recipe.density      || "medium",
      genrePreset:       recipe.genrePreset  || null,
      sceneDevices:      recipe.sceneDevices || [],
      emphasizedDegrees: emphDegrees,
    };
  }

  // -----------------------------------------------------------------------
  // suggestProgression(mood, overrides?)
  // → array of chord objects (same shape as Theory.diatonicChords entries)
  //
  // Returns 4 chords by default.  Each chord: { degree, roman, root, quality,
  // symbol, notes }.
  // -----------------------------------------------------------------------
  function suggestProgression(mood, overrides) {
    const T = root.Theory;
    if (!T) return [];
    const recipe = moodToMusic(mood, overrides);
    return T.generateProgression(recipe.key, recipe.scale, recipe.progressionStyle, 4);
  }

  // -----------------------------------------------------------------------
  // suggestRiff(mood, len?, overrides?)
  // → array of riff note objects: [{ rest, note, dur }]
  //
  // Uses Theory.generateMotif for a call-and-response melodic shape in the
  // mood's key/scale.  Falls back to a simple scale-walk if Theory unavailable.
  // -----------------------------------------------------------------------
  function suggestRiff(mood, len, overrides) {
    const T = root.Theory;
    if (!T) return [];
    const recipe   = moodToMusic(mood, overrides);
    const length   = len || 8;
    const baseOct  = recipe.scale.includes("phrygian") || recipe.scale.includes("locrian") || recipe.scale === "harmonicMinor" ? 3 : 4;
    return T.generateMotif(recipe.key, recipe.scale, length, baseOct);
  }

  // -----------------------------------------------------------------------
  // suggestDrums(mood, overrides?)
  // → { kick, snare, closedHat, openHat } (16-step boolean arrays)
  // -----------------------------------------------------------------------
  function suggestDrums(mood, overrides) {
    const T = root.Theory;
    if (!T) return null;
    const recipe = moodToMusic(mood, overrides);
    return T.getGroovePreset(recipe.groove);
  }

  // -----------------------------------------------------------------------
  // composeSong(opts)
  // opts: { mood, key?, scale?, tempo?, lengthBars? }
  //
  // Returns a complete song skeleton:
  //   {
  //     key, scale, scaleName, tempo, mood,
  //     progression: chord[],
  //     riff:        noteEvent[],
  //     drumGroove:  { kick, snare, closedHat, openHat },
  //     structure:   [{ name, bars, chords?, riff? }],
  //     recipe:      (the full moodToMusic recipe for further customisation)
  //   }
  //
  // All parts are internally consistent: riff is in the same scale as
  // chords, groove matches the mood, structure repeats sections logically.
  // Pure function — no DOM, no audio, safe to call anywhere.
  // -----------------------------------------------------------------------
  function composeSong(opts) {
    opts = opts || {};
    const T = root.Theory;
    if (!T) return null;

    // 1. Resolve recipe from mood + explicit overrides.
    // Only pass defined values so _recipe doesn't clobber table defaults.
    const _overrides = {};
    if (opts.key)   _overrides.key   = opts.key;
    if (opts.scale) _overrides.scale = opts.scale;
    const recipe = moodToMusic(opts.mood || "happy", _overrides);
    if (opts.tempo) recipe.tempo = opts.tempo;

    const { key, scale, tempo, groove, progressionStyle, octaveRange } = recipe;
    const scaleDef  = T.SCALES[scale] || T.SCALES.major;
    const scaleName = scaleDef.name;

    // 2. Chord progression (4 chords — one per "section chord")
    const progression = T.generateProgression(key, scale, progressionStyle, 4);
    if (!progression.length) return null;

    // 3. Riff (melodic motif, 8 notes)
    const baseOct  = recipe.energy > 6 ? 4 : 3;
    const riff     = T.generateMotif(key, scale, 8, baseOct);

    // 4. Drum groove
    const drumGroove = T.getGroovePreset(groove);

    // 5. Song structure
    const lengthBars = opts.lengthBars || 16;
    const chordsOnce = progression.map((c) => c.symbol).join(" – ");
    const structure  = _buildStructure(lengthBars, progression, riff, recipe);

    return {
      key, scale, scaleName, tempo,
      mood:      opts.mood || "happy",
      progression,
      riff,
      drumGroove,
      structure,
      recipe,
      // Convenience: voiced chords (with octaves) ready for AudioEngine.strum
      voicedProgression: progression.map((ch) => T.voiceChord(ch.notes, 3)),
      meta: {
        chordsLine: chordsOnce,
        scaleNotes: T.getScaleNotes(key, scale),
        energy:     recipe.energy,
        groove,
      },
    };
  }

  // Build a minimal song structure description.
  // Structure maps section names to { name, bars, chordIndices, riffVariant }
  // where chordIndices are indices into the progression array.
  function _buildStructure(totalBars, prog, riff, recipe) {
    const e = recipe.energy || 5;
    // Sections: intro(2) verse(4) chorus(4) verse(4) chorus(4) bridge(2) outro(2) — 22 bars
    // Scale down proportionally to fit totalBars, always end with chorus.
    const sections = [
      { name: "Intro",  bars: 2, desc: "Open with the groove, no melody yet",    chordIndices: [0, 1],    riffVariant: "sparse" },
      { name: "Verse",  bars: 4, desc: "Tell the story; sparse melody",           chordIndices: [0,1,2,3], riffVariant: "call" },
      { name: "Pre",    bars: 2, desc: "Build tension toward chorus",              chordIndices: [2, 3],    riffVariant: "rise" },
      { name: "Chorus", bars: 4, desc: "Full energy; hook melody",                chordIndices: [0,1,2,3], riffVariant: "full" },
      { name: "Verse",  bars: 4, desc: "Second verse; deeper story",              chordIndices: [0,1,2,3], riffVariant: "call" },
      { name: "Chorus", bars: 4, desc: "Full chorus repeat",                      chordIndices: [0,1,2,3], riffVariant: "full" },
      { name: "Bridge", bars: 2, desc: "Contrast: drop energy, new angle",        chordIndices: [2, 3],    riffVariant: "stripped" },
      { name: "Outro",  bars: 2, desc: "Fade on the groove; land on tonic chord", chordIndices: [0],       riffVariant: "sparse" },
    ];

    // Attach actual chord objects and the riff reference to each section
    return sections.map((s) => ({
      name:   s.name,
      bars:   s.bars,
      desc:   s.desc,
      chords: s.chordIndices.map((i) => prog[i % prog.length]).filter(Boolean),
      riffVariant: s.riffVariant,
      energy: _sectionEnergy(s.name, e),
    }));
  }

  // Energy level 1-10 for each section given the song's base energy.
  function _sectionEnergy(sectionName, baseEnergy) {
    const map = {
      Intro:  0.5, Verse: 0.65, Pre: 0.75,
      Chorus: 1.0, Bridge: 0.45, Outro: 0.4,
    };
    return Math.round((map[sectionName] || 0.7) * baseEnergy);
  }

  // -----------------------------------------------------------------------
  // onMoodChange(mood) — called by App.setMood() when the W/Noir theme
  // toggle fires.  Currently propagates the mood to Riff and Spark if loaded,
  // so their NEXT generation automatically reflects the new bias.
  // Frontend hook: App.setMood("noir") | App.setMood("w")  — that's all.
  // -----------------------------------------------------------------------
  function onMoodChange(mood) {
    // Riff: regenerate only if not in dirty (user-edited) state
    if (root.Riff && root.Riff.app && !root.Riff.dirty) {
      try { root.Riff.generate(); } catch (e) {}
    }
    // Spark: no auto-roll — let the user initiate, but next roll will use new bias
    // (Spark reads App.state.mood via App which is already updated before this is called)
  }

  // -----------------------------------------------------------------------
  // Public surface
  // -----------------------------------------------------------------------
  const MoodEngine = {
    MOOD_TABLE,
    moodToMusic,
    composeSong,
    suggestProgression,
    suggestRiff,
    suggestDrums,
    onMoodChange,
    // Helper: list all mood names + tags (useful for a frontend picker)
    moodNames() { return Object.keys(MOOD_TABLE); },
    moodTags()  { return Object.fromEntries(Object.entries(MOOD_TABLE).map(([k,v]) => [k, v.tags || []])); },
  };

  root.MoodEngine = MoodEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = MoodEngine;
})(typeof window !== "undefined" ? window : globalThis);
