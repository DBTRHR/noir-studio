/* =====================================================================
   NOIR Studio — Music Theory Engine
   Pure logic, no DOM / no audio. Safe to unit-test in Node.
   Exposes a global `Theory` object (and CommonJS export for tests).
   ===================================================================== */
(function (root) {
  "use strict";

  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  // Keys that conventionally use flats (major + their relative minors)
  const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb",
                             "D", "G", "C", "F", "Bb"]); // minors handled below
  // Letter natural pitches for correct scale spelling
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const LETTER_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // Scale / mode formulas (semitone offsets from the root)
  const SCALES = {
    major:            { name: "Major (Ionian)",     intervals: [0, 2, 4, 5, 7, 9, 11] },
    minor:            { name: "Natural Minor",       intervals: [0, 2, 3, 5, 7, 8, 10] },
    harmonicMinor:    { name: "Harmonic Minor",      intervals: [0, 2, 3, 5, 7, 8, 11] },
    melodicMinor:     { name: "Melodic Minor",       intervals: [0, 2, 3, 5, 7, 9, 11] },
    dorian:           { name: "Dorian",              intervals: [0, 2, 3, 5, 7, 9, 10] },
    phrygian:         { name: "Phrygian",            intervals: [0, 1, 3, 5, 7, 8, 10] },
    lydian:           { name: "Lydian",              intervals: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian:       { name: "Mixolydian",          intervals: [0, 2, 4, 5, 7, 9, 10] },
    locrian:          { name: "Locrian",             intervals: [0, 1, 3, 5, 6, 8, 10] },
    majorPentatonic:  { name: "Major Pentatonic",    intervals: [0, 2, 4, 7, 9] },
    minorPentatonic:  { name: "Minor Pentatonic",    intervals: [0, 3, 5, 7, 10] },
    blues:            { name: "Blues",               intervals: [0, 3, 5, 6, 7, 10] },
    phrygianDominant: { name: "Phrygian Dominant",   intervals: [0, 1, 4, 5, 7, 8, 10] },
  };

  // Diatonic triad qualities per scale degree (for the 7-note scales).
  // Derived from stacked thirds within each mode's own interval set.
  // Pentatonic / blues (< 7 notes) are handled by parent-scale fallback
  // in diatonicChords() — they are NOT listed here.
  const TRIAD_QUALITIES = {
    major:            ["maj", "min", "min", "maj", "maj", "min", "dim"],
    minor:            ["min", "dim", "maj", "min", "min", "maj", "maj"],
    harmonicMinor:    ["min", "dim", "aug", "min", "maj", "maj", "dim"],
    // Derived: i=min, ii=min, III+=aug, IV=maj, V=maj, vi°=dim, vii°=dim
    melodicMinor:     ["min", "min", "aug", "maj", "maj", "dim", "dim"],
    dorian:           ["min", "min", "maj", "maj", "min", "dim", "maj"],
    phrygian:         ["min", "maj", "maj", "min", "dim", "maj", "min"],
    // Derived: I=maj, II=maj, iii°=dim, iv=min, v°=dim, VI+=aug, VII=min
    phrygianDominant: ["maj", "maj", "dim", "min", "dim", "aug", "min"],
    lydian:           ["maj", "maj", "min", "dim", "maj", "min", "min"],
    mixolydian:       ["maj", "min", "dim", "maj", "min", "min", "maj"],
    locrian:          ["dim", "maj", "min", "min", "maj", "maj", "min"],
  };

  // Parent-scale mappings for pentatonic and blues scales.
  // When diatonicChords is called on these, we build chords from the
  // parent 7-note scale so every mood always returns a valid progression.
  // The pentatonic/blues riff and melody remain in their actual scale.
  const PENTATONIC_PARENT = {
    majorPentatonic: "major",
    minorPentatonic: "minor",
    blues:           "minor",  // blues is minor-pentatonic + b5; parent = natural minor
  };

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

  function noteIndex(name) {
    if (typeof name !== "string") return -1;
    const n = name.trim();
    const sharpIdx = SHARP.indexOf(n);
    if (sharpIdx >= 0) return sharpIdx;
    const flatIdx = FLAT.indexOf(n);
    if (flatIdx >= 0) return flatIdx;
    // Strip octave if present (e.g. "C#4")
    const m = n.match(/^([A-G])(#|b)?/);
    if (m) {
      let pitch = LETTER_PITCH[m[1]];
      if (m[2] === "#") pitch += 1;
      if (m[2] === "b") pitch -= 1;
      return ((pitch % 12) + 12) % 12;
    }
    return -1;
  }

  function mod(n, m) { return ((n % m) + m) % m; }

  function preferFlat(rootName, scaleType) {
    // Minor-ish contexts and explicitly flat roots lean flat for readability
    if (rootName.includes("b")) return true;
    if (rootName.includes("#")) return false;
    const minorish = ["minor", "harmonicMinor", "melodicMinor", "phrygian",
                      "locrian", "dorian", "minorPentatonic", "blues",
                      "phrygianDominant"];
    const flatNaturalMajors = ["F"];
    if (minorish.includes(scaleType)) {
      // F, C, G, D minors read better with flats; A, E, B with sharps
      return ["F", "C", "G", "D"].includes(rootName);
    }
    return flatNaturalMajors.includes(rootName);
  }

  function nameFromIndex(idx, flat) {
    return (flat ? FLAT : SHARP)[mod(idx, 12)];
  }

  // Spell a 7-tone diatonic scale with one letter per degree (correct accidentals)
  function spellDiatonic(rootName, intervals) {
    const rootLetter = rootName[0];
    const rootLetterIdx = LETTERS.indexOf(rootLetter);
    const rootPitch = noteIndex(rootName);
    const out = [];
    for (let i = 0; i < intervals.length; i++) {
      const targetPitch = mod(rootPitch + intervals[i], 12);
      const letter = LETTERS[mod(rootLetterIdx + i, 7)];
      const natural = LETTER_PITCH[letter];
      let diff = mod(targetPitch - natural, 12);
      if (diff > 6) diff -= 12; // choose nearest accidental
      let acc = "";
      if (diff === 1) acc = "#";
      else if (diff === 2) acc = "##";
      else if (diff === -1) acc = "b";
      else if (diff === -2) acc = "bb";
      out.push(letter + acc);
    }
    return out;
  }

  // Main: returns array of note names for a scale rooted at `rootName`
  function getScaleNotes(rootName, scaleType) {
    const scale = SCALES[scaleType];
    if (!scale) return [];
    const intervals = scale.intervals;
    if (intervals.length === 7) {
      return spellDiatonic(rootName, intervals);
    }
    const flat = preferFlat(rootName, scaleType);
    const rootPitch = noteIndex(rootName);
    return intervals.map((iv) => nameFromIndex(rootPitch + iv, flat));
  }

  // Pitch-class set (0-11) for quick membership tests
  function getScalePitchClasses(rootName, scaleType) {
    const scale = SCALES[scaleType];
    if (!scale) return new Set();
    const rootPitch = noteIndex(rootName);
    return new Set(scale.intervals.map((iv) => mod(rootPitch + iv, 12)));
  }

  // Relative minor of a major root (down a minor 3rd / up a major 6th)
  function relativeMinor(rootName) {
    const flat = preferFlat(rootName, "minor");
    return nameFromIndex(noteIndex(rootName) + 9, flat);
  }
  // Relative major of a minor root (up a minor 3rd)
  function relativeMajor(rootName) {
    const idx = noteIndex(rootName) + 3;
    return nameFromIndex(idx, preferFlat(nameFromIndex(idx, false), "major"));
  }
  // Parallel minor of a major root: SAME tonic, minor scale.
  // Returns the root respelled for the minor context (e.g. C Major -> C minor,
  // G Major -> G minor). Pitch is unchanged; only the preferred accidental
  // spelling may differ from the major-key spelling.
  function parallelMinor(rootName) {
    const flat = preferFlat(rootName, "minor");
    return nameFromIndex(noteIndex(rootName), flat);
  }
  // Parallel major of a minor root: SAME tonic, major scale (mirror direction).
  function parallelMajor(rootName) {
    const flat = preferFlat(rootName, "major");
    return nameFromIndex(noteIndex(rootName), flat);
  }
  function dominant(rootName)    { return nameFromIndex(noteIndex(rootName) + 7, false); }
  function subdominant(rootName) { return nameFromIndex(noteIndex(rootName) + 5, false); }

  // Build a triad (3 note names) from a scale degree
  function triadAtDegree(scaleNotes, degree) {
    const n = scaleNotes.length;
    return [scaleNotes[degree % n],
            scaleNotes[(degree + 2) % n],
            scaleNotes[(degree + 4) % n]];
  }

  // Diatonic chords for a key: [{ degree, roman, root, quality, symbol, notes[] }]
  //
  // For pentatonic and blues scales (< 7 notes), falls back to the parent
  // 7-note scale so a valid progression is always returned.  The parent is
  // chosen to preserve the harmonic color: major-pent → major, minor-pent /
  // blues → natural minor.  Callers get real chords; melody/riff generators
  // still use the actual pentatonic/blues note pool.
  function diatonicChords(rootName, scaleType) {
    // Resolve pentatonic/blues to parent scale for chord generation
    const effectiveType = PENTATONIC_PARENT[scaleType] || scaleType;

    const qualities = TRIAD_QUALITIES[effectiveType];
    const notes = getScaleNotes(rootName, effectiveType);
    if (!qualities || notes.length !== 7) return [];

    return qualities.map((q, i) => {
      const triad = triadAtDegree(notes, i);
      let roman = ROMAN[i];
      if (q === "min" || q === "dim") roman = roman.toLowerCase();
      if (q === "dim") roman += "°";
      if (q === "aug") roman += "+";
      const symbol = triad[0] + (q === "maj" ? "" : q === "min" ? "m"
                      : q === "dim" ? "dim" : "aug");
      return { degree: i, roman, root: triad[0], quality: q, symbol, notes: triad };
    });
  }

  // Convert a note name + octave into a MIDI-ish absolute note for audio (e.g. "C#4")
  // Returns the note with octave for playback given a base octave.
  function withOctave(noteName, octave) {
    return noteName.replace(/\d+$/, "") + octave;
  }

  // List of all 12 roots (sharp + common flat spellings for the picker)
  const ALL_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // -----------------------------------------------------------------------
  // NEW: Extended chord vocabulary
  // -----------------------------------------------------------------------

  // Interval offsets for each chord quality (from root, semitones)
  const CHORD_INTERVALS = {
    maj:    [0, 4, 7],
    min:    [0, 3, 7],
    dim:    [0, 3, 6],
    aug:    [0, 4, 8],
    "7":    [0, 4, 7, 10],   // dominant 7th
    maj7:   [0, 4, 7, 11],
    min7:   [0, 3, 7, 10],
    dim7:   [0, 3, 6, 9],
    "9":    [0, 4, 7, 10, 14],
    maj9:   [0, 4, 7, 11, 14],
    min9:   [0, 3, 7, 10, 14],
    sus2:   [0, 2, 7],
    sus4:   [0, 5, 7],
    "add9": [0, 4, 7, 14],
    "6":    [0, 4, 7, 9],
    min6:   [0, 3, 7, 9],
    "11":   [0, 4, 7, 10, 14, 17],
    "13":   [0, 4, 7, 10, 14, 17, 21],
  };

  // Build an extended chord: returns array of note names starting from rootName.
  // quality is one of the CHORD_INTERVALS keys above.
  function buildChord(rootName, quality) {
    const ivs = CHORD_INTERVALS[quality];
    if (!ivs) return [];
    const flat = preferFlat(rootName, quality.includes("min") ? "minor" : "major");
    const rootPc = noteIndex(rootName);
    return ivs.map((iv) => nameFromIndex(rootPc + iv, flat));
  }

  // -----------------------------------------------------------------------
  // NEW: Secondary dominant generator
  // Returns the dominant 7th chord that resolves to the given scale degree
  // of the current key.  e.g. secondaryDominant("C","major",1) => G7 (V/ii)
  // degreeIndex is 0-based (0=I, 1=ii, etc.)
  // -----------------------------------------------------------------------
  function secondaryDominant(rootName, scaleType, degreeIndex) {
    const notes = getScaleNotes(rootName, scaleType);
    if (!notes || !notes[degreeIndex]) return null;
    const targetRoot = notes[degreeIndex];
    // V7 of X resolves to X. The root of that dominant lies a perfect fifth ABOVE X
    // (equivalently a perfect fourth below). A perfect fifth = 7 semitones up.
    // e.g. V/ii in C major: ii = D, dominant of D = A (2 + 7 = 9 = A). A7 -> Dm.
    const domPc = mod(noteIndex(targetRoot) + 7, 12);
    const flat = preferFlat(rootName, scaleType);
    const domRoot = nameFromIndex(domPc, flat);
    const notes7 = buildChord(domRoot, "7");
    return {
      root: domRoot,
      quality: "7",
      symbol: domRoot + "7",
      notes: notes7,
      resolvesDegree: degreeIndex,
      resolvesTo: targetRoot,
    };
  }

  // -----------------------------------------------------------------------
  // NEW: Borrowed chord generator (modal interchange)
  // Returns borrowed chords from the parallel mode on the same tonic.
  // Each entry: { roman, symbol, notes, borrowedFrom, rationale }
  // For major keys borrows from parallel minor (Aeolian) and Phrygian.
  // For minor keys borrows from parallel major.
  // -----------------------------------------------------------------------
  function borrowedChords(rootName, scaleType) {
    const borrowed = [];
    if (scaleType === "major") {
      // From parallel natural minor: bIII, iv, bVI, bVII
      const minNotes = getScaleNotes(rootName, "minor");
      const buildBorrowed = (degIdx, romanStr, rationale) => {
        if (!minNotes[degIdx]) return;
        const chordNotes = [
          minNotes[degIdx],
          minNotes[(degIdx + 2) % 7],
          minNotes[(degIdx + 4) % 7],
        ];
        // determine quality from minor triad qualities
        const minQualities = TRIAD_QUALITIES.minor;
        const q = minQualities[degIdx];
        const sym = chordNotes[0] + (q === "maj" ? "" : q === "min" ? "m" : q === "dim" ? "dim" : "aug");
        borrowed.push({ roman: romanStr, symbol: sym, notes: chordNotes, borrowedFrom: rootName + " minor", rationale });
      };
      buildBorrowed(2, "bIII",  "Bittersweet lift, aeolian color");
      buildBorrowed(3, "iv",   "The aching minor IV — arpeggiates regret");
      buildBorrowed(5, "bVI",  "Dark lift, borrowed Hollywood drama");
      buildBorrowed(6, "bVII", "Anthemic major chord a step below the tonic");
    } else if (scaleType === "minor" || scaleType === "dorian" || scaleType === "phrygian") {
      // From parallel major: IV (major), I (major)
      const majNotes = getScaleNotes(rootName, "major");
      const majQ = TRIAD_QUALITIES.major;
      const buildMaj = (degIdx, romanStr, rationale) => {
        if (!majNotes[degIdx]) return;
        const chordNotes = [majNotes[degIdx], majNotes[(degIdx + 2) % 7], majNotes[(degIdx + 4) % 7]];
        const q = majQ[degIdx];
        const sym = chordNotes[0] + (q === "maj" ? "" : q === "min" ? "m" : "dim");
        borrowed.push({ roman: romanStr, symbol: sym, notes: chordNotes, borrowedFrom: rootName + " major", rationale });
      };
      buildMaj(3, "IV", "Picardy-style lift into major subdominant");
      buildMaj(0, "I",  "Picardy third — major tonic for a surprise bright landing");
    }
    return borrowed;
  }

  // -----------------------------------------------------------------------
  // NEW: Progression generator
  // Returns a curated sequence of diatonic chord objects for the given key,
  // style, and number of chords. Optionally includes one borrowed chord.
  // style: "pop" | "jazz" | "blues" | "metal" | "neo-soul" | "dorian"
  // Returns [{ degree, roman, root, quality, symbol, notes, borrowed? }]
  // -----------------------------------------------------------------------
  const PROG_LIBRARY = {
    // [degree indices into diatonicChords array]
    pop:      [[0,4,5,3],[0,5,3,4],[5,3,0,4],[0,3,4,0]],
    jazz:     [[1,4,0,0],[1,4,0,5],[0,1,4,0],[5,1,4,0]],
    blues:    [[0,3,0,3,4,3,0,4]],        // simplified 8-degree blues loop
    metal:    [[0,5,4,6],[0,6,5,4],[0,5,2,6]],
    "neo-soul":[[0,3,6,4],[0,3,1,4],[1,4,0,3]],
    dorian:   [[0,3,0,6],[0,3,4,0],[0,6,3,4]],
  };

  function generateProgression(rootName, scaleType, style, numChords) {
    const chords = diatonicChords(rootName, scaleType);
    if (!chords.length) return [];
    const lib = PROG_LIBRARY[style] || PROG_LIBRARY.pop;
    const template = lib[Math.floor(Math.random() * lib.length)];
    const seq = [];
    for (let i = 0; i < (numChords || template.length); i++) {
      const idx = template[i % template.length] % chords.length;
      seq.push(Object.assign({}, chords[idx]));
    }
    return seq;
  }

  // -----------------------------------------------------------------------
  // generateMotif — arch-contour call-and-response melody generator.
  // Updated from research: arch peak at 60-66%, gap-fill after leaps,
  // interval weighting, emphasized scale degrees, repeat-2x-then-vary.
  //
  // Returns: [{ rest:false, note:"C4", dur:"8n" }]  (Riff.riff shape)
  // -----------------------------------------------------------------------
  function generateMotif(rootName, scaleType, length, baseOctave) {
    length = length || 8;
    baseOctave = baseOctave || 4;
    const notes = getScaleNotes(rootName, scaleType);
    if (!notes || !notes.length) return [];

    // Build 3-octave pool: one below, one at, one above base octave
    const pool = [];
    for (let o = baseOctave - 1; o <= baseOctave + 1; o++) {
      notes.forEach((n) => pool.push(n + o));
    }

    const rootPc = noteIndex(rootName);
    // Find root at baseOctave as starting index
    let idx = pool.findIndex((n) => {
      const m = n.match(/^([A-G]#?b?)(\d)$/);
      return m && noteIndex(m[1]) === rootPc && parseInt(m[2], 10) === baseOctave;
    });
    if (idx < 0) idx = Math.floor(pool.length / 2);

    // Emphasized degree indices for this scale (0-based, maps to note name positions)
    const emphDegrees = EMPHASIZED_DEGREES[scaleType] || [];
    // Build a set of pitch classes that are emphasized
    const emphPCs = new Set(emphDegrees.map((d) => noteIndex(notes[d % notes.length])));

    // Choose a weighted move from current pool index.
    // intervalWeights: [unison(0), step(1-2), skip(3-4), leap(5-7), bigLeap(8+)]
    // in pool-index units: unison=0, step=1, skip=2, leap=3, bigLeap=4+
    // Source: RIFF_PARAMS.base.intervalWeights
    const IW = RIFF_PARAMS.base.intervalWeights;
    function weightedMove(rng) {
      const r = rng();
      let cum = 0;
      const sizes = [0, 1, 2, 3, 4];
      for (let i = 0; i < IW.length; i++) {
        cum += IW[i];
        if (r < cum) return sizes[i] * (rng() < 0.5 ? 1 : -1);
      }
      return rng() < 0.5 ? 1 : -1;
    }

    const halfLen = Math.ceil(length / 2);
    const peakPos = Math.round(length * RIFF_PARAMS.base.archPeakPosition);
    const DUR_OPTIONS = ["16n","8n","8n","8n","4n","4n"];
    const rng = Math.random;

    // --- BUILD CALL (first half): arch shape + gap-fill ---
    const callSeq = [];
    // Direction: rise to peak, then fall.
    // Net movement from start to peak should be positive (upward).
    const risingPhase = peakPos;
    let peakIdx = Math.min(pool.length - 1, idx + Math.floor(pool.length * 0.25));

    for (let i = 0; i < halfLen; i++) {
      // ARCH: during first 60% rise, bias upward; after, bias downward
      const progress = (i + 1) / halfLen;
      let move;
      if (progress < RIFF_PARAMS.base.archPeakPosition) {
        // Rising phase: prefer upward moves
        move = Math.abs(weightedMove(rng));
      } else {
        // Descending phase: prefer downward moves
        move = -Math.abs(weightedMove(rng));
      }
      // On unison (move = 0), keep as-is
      let newIdx = Math.max(0, Math.min(pool.length - 1, idx + move));

      // Bias toward emphasized scale degrees
      if (emphPCs.size > 0 && rng() < 0.3) {
        // Find nearest emphasized note within 2 steps
        for (let r2 = 1; r2 <= 2; r2++) {
          const checkIdx = move >= 0 ? newIdx + r2 : newIdx - r2;
          const ni = Math.max(0, Math.min(pool.length - 1, checkIdx));
          const pc = noteIndex(pool[ni].replace(/\d+$/, ""));
          if (emphPCs.has(pc)) { newIdx = ni; break; }
        }
      }

      // GAP-FILL: after a leap (pool distance >= gapFillThreshold) step back
      const semitones = Math.abs(newIdx - idx) * 2; // approximate semitones from pool distance
      const gap = RIFF_PARAMS.base.gapFillThreshold;
      if (semitones >= gap && callSeq.length > 0) {
        // Step back in the opposite direction
        const gapFill = Math.max(0, Math.min(pool.length - 1, newIdx + (move > 0 ? -1 : 1)));
        callSeq.push({ rest: false, note: pool[gapFill], dur: "8n" });
        idx = gapFill;
      }

      idx = newIdx;
      const dur = DUR_OPTIONS[Math.floor(rng() * DUR_OPTIONS.length)];
      callSeq.push({ rest: false, note: pool[idx], dur });
      if (callSeq.length >= halfLen) break;
    }
    // Pad call if short
    while (callSeq.length < halfLen) callSeq.push({ ...callSeq[callSeq.length - 1] });

    // --- BUILD RESPONSE (second half): vary back-half, resolve to root ---
    // Research: "repeat exactly 2x, vary on 3rd pass — vary the back half"
    // For a single 2-bar motif, call = bar1, response = bar2 (varied).
    const respSeq = [];
    for (let i = 0; i < length - halfLen - 1; i++) {
      const src = callSeq[i % callSeq.length];
      if (!src) break;
      let newIdx2 = pool.indexOf(src.note);
      if (newIdx2 < 0) newIdx2 = idx;

      // Vary: diatonic 2nd/3rd sequence (descend toward root for resolution)
      const drift = i < 2 ? 0 : (rng() < 0.55 ? (rng() < 0.6 ? -1 : 1) : 0);
      newIdx2 = Math.max(0, Math.min(pool.length - 1, newIdx2 + drift));

      // Post-leap reversal: if previous move was large, force stepwise reversal
      if (respSeq.length > 0) {
        const prev = respSeq[respSeq.length - 1];
        if (!prev.rest) {
          const prevI = pool.indexOf(prev.note);
          const leap  = Math.abs(newIdx2 - prevI);
          // Pool index units * ~2 ≈ semitones; 6 semitones = 3 pool steps
          if (leap >= 3 && rng() < 0.7) {
            newIdx2 = Math.max(0, Math.min(pool.length - 1, prevI + (prevI > newIdx2 ? -1 : 1)));
          }
        }
      }

      const dur = DUR_OPTIONS[Math.floor(rng() * DUR_OPTIONS.length)];
      respSeq.push({ rest: false, note: pool[newIdx2], dur });
    }

    // Resolution: final note = root at baseOctave (or root at closest octave)
    const rootNote = rootName + baseOctave;
    const resolveNote = pool.includes(rootNote) ? rootNote : pool[idx];
    respSeq.push({ rest: false, note: resolveNote, dur: "4n" });

    return callSeq.concat(respSeq).slice(0, length);
  }

  // -----------------------------------------------------------------------
  // NEW: Genre groove presets (step-sequencer patterns)
  // Returns an object { kick, snare, closedHat, openHat } where each value
  // is a 16-element boolean array (steps in a single bar of 16th notes).
  // -----------------------------------------------------------------------
  const GROOVE_PRESETS = {
    rock: {
      kick:      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    },
    funk: {
      kick:      [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,0,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    },
    metal: {
      kick:      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    hiphop: {
      kick:      [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      openHat:   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    },
    "neo-soul": {
      kick:      [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      snare:     [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
      closedHat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    },
    blues: {
      kick:      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    bossa: {
      kick:      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare:     [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      closedHat: [1,0,1,1, 0,1,0,0, 1,0,1,1, 0,1,0,0],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    // Metalcore/deathcore chug pattern: 3-3-2 grouping lurch
    // Kick on group starts, snare on 2&4, fast closed-hat.
    "metalcore-dark": {
      kick:      [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0],
      snare:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      closedHat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    // Doom: slow and crushing — kick on 1, snare on 3, lots of space
    doom: {
      kick:      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      snare:     [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      closedHat: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      openHat:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    },
  };

  function getGroovePreset(genre) {
    return GROOVE_PRESETS[genre] || GROOVE_PRESETS.rock;
  }

  // List available groove genre names
  function groovePresetNames() {
    return Object.keys(GROOVE_PRESETS);
  }

  // -----------------------------------------------------------------------
  // SCALE_MOODS: parallel metadata for every SCALES entry.
  // mood    — one-line emotional label shown in UI
  // palette — "dark" | "bright" | "neutral" (for mood biasing)
  // tempo   — suggested BPM range [min, max]
  // -----------------------------------------------------------------------
  const SCALE_MOODS = {
    major:            { mood: "Bright & happy",          palette: "bright",  tempo: [90, 140] },
    minor:            { mood: "Melancholy & sad",         palette: "dark",    tempo: [60, 110] },
    harmonicMinor:    { mood: "Exotic & suspenseful",     palette: "dark",    tempo: [65, 115] },
    melodicMinor:     { mood: "Sophisticated & smooth",   palette: "neutral", tempo: [70, 120] },
    dorian:           { mood: "Cool-sad & jazzy",         palette: "neutral", tempo: [80, 130] },
    phrygian:         { mood: "Dark & menacing",          palette: "dark",    tempo: [70, 130] },
    lydian:           { mood: "Dreamy & magical",         palette: "bright",  tempo: [80, 130] },
    mixolydian:       { mood: "Anthemic & bluesy",        palette: "bright",  tempo: [85, 145] },
    locrian:          { mood: "Tense & unstable",         palette: "dark",    tempo: [60, 110] },
    majorPentatonic:  { mood: "Open & mellow",            palette: "bright",  tempo: [80, 140] },
    minorPentatonic:  { mood: "Raw & riff-ready",         palette: "dark",    tempo: [70, 130] },
    blues:            { mood: "Gritty & expressive",      palette: "dark",    tempo: [60, 120] },
    phrygianDominant: { mood: "Exotic flamenco-evil",     palette: "dark",    tempo: [70, 130] },
  };

  // -----------------------------------------------------------------------
  // MOOD_BIAS: maps app mood ("noir" | "w") to generation defaults.
  // scales     — weighted list, used by mood engine to pick defaults
  // tempoRange — [min, max] BPM
  // groove     — preferred groove genre
  // progressionStyle — matches PROG_LIBRARY keys
  // -----------------------------------------------------------------------
  const MOOD_BIAS = {
    // NOIR: dark minor/Phrygian/harmonic-minor; lower tempo; more space;
    // tritone/b2/b6 emphasis; descending contour; heavy syncopation.
    // Research: "Aeolian/Phrygian(b2)/Locrian/harmonic-minor/Phrygian-dominant;
    //  emphasize b2,b6,b5(tritone),b3; descending/narrow low contour; more space"
    noir: {
      scales: [
        ["minor", 3], ["phrygian", 3], ["harmonicMinor", 2],
        ["phrygianDominant", 2], ["locrian", 1], ["minorPentatonic", 2],
        ["blues", 2], ["dorian", 1],
      ],
      tempoRange:        [55, 110],
      groove:            "metal",
      progressionStyle:  "metal",
      octaveBias:        "low",          // low register preferred
      restProbability:   0.28,           // updated from research (20-35% range → 28%)
      leapProbability:   0.40,
      // Emphasized degrees: b2 (Phrygian), tritone, b6 — sinister character
      emphasizedSemitones: [1, 6, 8],   // [b2, tritone, b6] relative to root
      contour:           "descending",   // net-descending phrase shape
      intervalBias:      "minor2nd+tritone", // m2 and tritone favored in dark context
    },
    // W: bright Ionian/Lydian/Mixolydian; higher tempo; ascending contour;
    // consonant 1/3/5 landings; bouncy, less space.
    // Research: "Lydian(#4)/Ionian/Mixolydian(b7); tempo>=120;
    //  ascending leaps, M3/M6/P4/P5; net-ascending contour, high peaks"
    w: {
      scales: [
        ["major", 3], ["lydian", 2], ["mixolydian", 2],
        ["majorPentatonic", 2], ["dorian", 1], ["melodicMinor", 1],
      ],
      tempoRange:        [90, 150],
      groove:            "funk",
      progressionStyle:  "pop",
      octaveBias:        "high",
      restProbability:   0.12,           // less space, more energy
      leapProbability:   0.22,
      // Emphasized degrees: 3rd (Ionian), #4 (Lydian), b7 (Mixolydian)
      emphasizedSemitones: [4, 6, 10],  // [M3, #4/tritone bright, m7] relative to root
      contour:           "ascending",    // net-ascending phrase shape
      intervalBias:      "major3rd+perfect5th", // M3/M6/P4/P5 favored
    },
  };

  // -----------------------------------------------------------------------
  // EMPHASIZED_DEGREES: per-scale degree(s) to weight more heavily when
  // building the note pool for a riff or melody.  Indices are 0-based
  // positions in the scale's interval array (0=root, 1=2nd, 2=3rd, …).
  // Source: research-codify-intentional-composition.md § mode -> mood.
  // -----------------------------------------------------------------------
  const EMPHASIZED_DEGREES = {
    major:            [2],          // emph 3rd — bright/happy
    minor:            [2, 5],       // emph b3 & b6 — sad
    harmonicMinor:    [5, 6],       // emph nat7 over b6; aug2 interval
    melodicMinor:     [5, 6],       // nat6 & nat7 ascending
    dorian:           [5],          // nat6 — hopeful tinge in minor
    phrygian:         [1],          // b2 — dark/exotic signature tone
    lydian:           [3],          // #4 — dreamy, floating
    mixolydian:       [6],          // b7 — bluesy/rebellious
    locrian:          [4],          // b5 — eerie, avoid (sparingly)
    majorPentatonic:  [],           // all open/innocent
    minorPentatonic:  [2, 4],       // b3, blue-note b5 tendency
    blues:            [2, 3],       // b3 & b5 (blue note)
    phrygianDominant: [1, 2],       // b2 + major3 — sinister/Spanish
  };

  // -----------------------------------------------------------------------
  // GENRE_PRESETS: dark-genre recipe metadata consumed by the mood engine
  // and riff generator.  Each entry is a parameter bundle (not code) that
  // the generator reads and applies.  Tunable — update params, not logic.
  //
  // Source: research-codify-catchy-music.md § Genre presets (dark-genre)
  //         research-codify-intentional-composition.md § dark-genre presets
  // -----------------------------------------------------------------------
  const GENRE_PRESETS = {
    "metalcore-dark": {
      // Metalcore/deathcore dark riff
      scales:            ["phrygianDominant", "harmonicMinor", "phrygian", "locrian"],
      emphasizedDegrees: [1, 2],       // b2 + major3 / b6 sinister weight
      tritoneAccent:     true,         // inject tritone as accent (≤2 per riff)
      tritoneMaxPerRiff: 2,
      pedalTone:         true,         // alternate root chugs with off-beat dyads
      chugGroupings:     [[3,3,2],[3,3,3,3,2,2],[5,3],[4,4,1]], // groove lurch patterns
      tempoRange:        [60, 90],     // downtempo breakdown feel
      restAtGroupBoundary: true,
      stepVsLeapRatio:   0.50,         // more leaps than standard
      restProbability:   0.25,
      chordToneBias:     0.35,
      octaveRange:       2,
      register:          "low",        // pool shifted down
      resolveTritone:    "inward",     // tritone resolves by half-step inward
    },
    "prog-dark-lead": {
      // Pink Floyd / prog dark melodic lead
      scales:            ["minorPentatonic", "blues", "minor"],
      emphasizedDegrees: [2, 3],       // b3, b5 blue note
      tritoneAccent:     true,
      tritoneMaxPerRiff: 1,
      tempoRange:        [60, 95],
      stepVsLeapRatio:   0.65,
      restProbability:   0.45,         // "lots of space" per research
      chordToneBias:     0.5,
      octaveRange:       2,
      register:          "mid",
      sustainedOpener:   true,         // phrase begins with held note
      contour:           "held-develop-return",
    },
    "doom": {
      scales:            ["minor", "phrygian"],
      emphasizedDegrees: [1, 5],       // b2 & b6 low/heavy
      tempoRange:        [40, 70],
      stepVsLeapRatio:   0.80,         // mostly steps — narrow, slow
      restProbability:   0.50,         // maximum space
      chordToneBias:     0.70,
      octaveRange:       1,            // stay very low
      register:          "low",
      sustainedNotes:    true,
      hypnoticRepeat:    true,
      contour:           "descending",
    },
    "post-rock": {
      scales:            ["major", "minor", "dorian"],
      emphasizedDegrees: [2, 5],
      tempoRange:        [80, 130],
      stepVsLeapRatio:   0.75,
      restProbability:   0.35,
      chordToneBias:     0.65,
      octaveRange:       3,            // wide range for build
      register:          "mid",
      contour:           "ascending-build",
      energyBuild:       true,
    },
  };

  // -----------------------------------------------------------------------
  // RIFF_PARAMS: tunable defaults for riff generators.
  // Updated from research-codify-catchy-music.md:
  //   stepVsLeapRatio baseline = 0.70 (research: 70:30 rule)
  //   restProbability baseline = 0.20-0.35 range; 0.22 for generic
  //   chordToneBias = 0.65 (chord tones on strong beats, research: "weight 1&5 highest")
  //   archContour = true (peak at ~60-66% through phrase then descend)
  //   gapFillThreshold = 5 semitones (leap ≥ 4th = 5 semitones triggers gap-fill)
  //   postLeapReversal = 6 (leaps ≥ 6 semitones force stepwise reversal)
  //   repeatBeforeVary = 2 (repeat exactly 2x, vary on 3rd pass)
  //   intervalWeights = descending probability: unison > 2nd > 3rd > 4th/5th > 6th+
  // -----------------------------------------------------------------------
  const RIFF_PARAMS = {
    // Base parameters (genre-independent defaults)
    base: {
      octaveRange:           2,      // pool spans 2 octaves (80% in core, extremes for peaks)
      octaveJumpProbability: 0.15,   // ~once per 4-repeat cycle at phrase boundaries
      stepVsLeapRatio:       0.70,   // research: 70:30 step:leap is the sweet spot
      motifRepeatThenVary:   true,   // repeat 2x exactly, vary back-half on 3rd pass
      repeatBeforeVary:      2,      // how many exact repeats before variation
      restProbability:       0.22,   // ~20-35% rests per research (22% default)
      chordToneBias:         0.65,   // strong beats bias toward chord tones {1,3,5}
      archContour:           true,   // place phrase peak at ~62% then descend to root
      archPeakPosition:      0.62,   // 0-1 fraction where arch peaks (research: 60-66%)
      gapFillThreshold:      5,      // leap >= this many semitones triggers gap-fill step
      postLeapReversalMin:   6,      // leap >= 6 semitones forces 1-2 steps back
      // Interval move weights (relative probabilities): [unison, step, skip, leap, bigLeap]
      // "skip" = 3rd (3-4 semitones); "leap" = 4th-5th (5-7); "bigLeap" = 6th+ (8+)
      intervalWeights:       [0.15,  0.42,  0.22,  0.15,  0.06],
    },
    // Per-mood overrides (merged over base at generation time)
    noir: {
      octaveRange:           3,
      octaveJumpProbability: 0.20,   // more register contrast in noir
      stepVsLeapRatio:       0.60,   // darker = more leaps (research: Aeolian/Phrygian = descending leaps)
      restProbability:       0.28,   // more space, more tension
      chordToneBias:         0.45,   // less consonant landing — tension stays unresolved longer
      archContour:           true,
      archPeakPosition:      0.55,   // noir peak comes earlier, longer descent
      intervalWeights:       [0.10, 0.35, 0.22, 0.22, 0.11],  // more leaps/big-leaps
    },
    w: {
      octaveRange:           2,
      octaveJumpProbability: 0.08,   // stay in core range more
      stepVsLeapRatio:       0.78,   // bright = more steps (ascending, consonant)
      restProbability:       0.12,   // less space, more energy
      chordToneBias:         0.72,   // land on chord tones, stay happy
      archContour:           true,
      archPeakPosition:      0.67,   // W peak later — builds longer, shorter descent
      intervalWeights:       [0.15, 0.48, 0.22, 0.11, 0.04],  // fewer leaps
    },
  };

  // Merge base + mood-specific riff params. mood = "noir" | "w" | null.
  function getRiffParams(mood) {
    const base = Object.assign({}, RIFF_PARAMS.base);
    const over = RIFF_PARAMS[mood] || {};
    return Object.assign(base, over);
  }

  // -----------------------------------------------------------------------
  // voiceChord — consistent chord voicing used across modules.
  // notes: string[] of note names (no octave).
  // baseOctave: integer, default 3.
  // Returns: string[] like ["C3","E3","G3"] — ascending, no collisions.
  // -----------------------------------------------------------------------
  function voiceChord(notes, baseOctave) {
    const oct = baseOctave == null ? 3 : baseOctave;
    let curOct = oct, prevPc = -1;
    return notes.map((n) => {
      const pc = noteIndex(n);
      if (prevPc >= 0 && pc <= prevPc) curOct++;
      prevPc = pc;
      return n + curOct;
    });
  }

  // chordForDegree — returns a voiced playable chord for a given scale degree.
  // rootName, scaleType: key context.
  // degreeIndex: 0-based diatonic degree.
  // baseOctave: default 3.
  // Returns: { symbol, roman, notes (with octaves), rawNotes (no octaves) } | null
  function chordForDegree(rootName, scaleType, degreeIndex, baseOctave) {
    const chords = diatonicChords(rootName, scaleType);
    if (!chords || !chords[degreeIndex]) return null;
    const ch = chords[degreeIndex];
    return {
      symbol:    ch.symbol,
      roman:     ch.roman,
      rawNotes:  ch.notes,
      notes:     voiceChord(ch.notes, baseOctave == null ? 3 : baseOctave),
    };
  }

  // -----------------------------------------------------------------------
  // weightedPick — utility used by mood engine.
  // pairs: [[item, weight], ...]  Returns a random item weighted by weight.
  // -----------------------------------------------------------------------
  function weightedPick(pairs, rng) {
    const rand = rng || Math.random;
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = rand() * total;
    for (const [item, w] of pairs) { r -= w; if (r <= 0) return item; }
    return pairs[pairs.length - 1][0];
  }

  const Theory = {
    SHARP, FLAT, SCALES, TRIAD_QUALITIES, PENTATONIC_PARENT, ROMAN, ALL_ROOTS,
    CHORD_INTERVALS, GROOVE_PRESETS, SCALE_MOODS, MOOD_BIAS, RIFF_PARAMS,
    // Round 3 (research-pass) exports
    EMPHASIZED_DEGREES, GENRE_PRESETS,
    noteIndex, mod, nameFromIndex, preferFlat,
    getScaleNotes, getScalePitchClasses,
    relativeMinor, relativeMajor, parallelMinor, parallelMajor, dominant, subdominant,
    triadAtDegree, diatonicChords, withOctave,
    // Round 1 exports
    buildChord, secondaryDominant, borrowedChords,
    generateProgression, generateMotif,
    getGroovePreset, groovePresetNames,
    // Round 2 exports
    voiceChord, chordForDegree, getRiffParams, weightedPick,
  };

  root.Theory = Theory;
  if (typeof module !== "undefined" && module.exports) module.exports = Theory;
})(typeof window !== "undefined" ? window : globalThis);
