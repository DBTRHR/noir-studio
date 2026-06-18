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

  // Diatonic triad qualities per scale degree (for the 7-note scales)
  const TRIAD_QUALITIES = {
    major:         ["maj", "min", "min", "maj", "maj", "min", "dim"],
    minor:         ["min", "dim", "maj", "min", "min", "maj", "maj"],
    harmonicMinor: ["min", "dim", "aug", "min", "maj", "maj", "dim"],
    dorian:        ["min", "min", "maj", "maj", "min", "dim", "maj"],
    phrygian:      ["min", "maj", "maj", "min", "dim", "maj", "min"],
    lydian:        ["maj", "maj", "min", "dim", "maj", "min", "min"],
    mixolydian:    ["maj", "min", "dim", "maj", "min", "min", "maj"],
    locrian:       ["dim", "maj", "min", "min", "maj", "maj", "min"],
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
  function diatonicChords(rootName, scaleType) {
    const qualities = TRIAD_QUALITIES[scaleType];
    const notes = getScaleNotes(rootName, scaleType);
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

  const Theory = {
    SHARP, FLAT, SCALES, TRIAD_QUALITIES, ROMAN, ALL_ROOTS,
    noteIndex, mod, nameFromIndex, preferFlat,
    getScaleNotes, getScalePitchClasses,
    relativeMinor, relativeMajor, parallelMinor, parallelMajor, dominant, subdominant,
    triadAtDegree, diatonicChords, withOctave,
  };

  root.Theory = Theory;
  if (typeof module !== "undefined" && module.exports) module.exports = Theory;
})(typeof window !== "undefined" ? window : globalThis);
