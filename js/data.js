/* =====================================================================
   NOIR Studio — Data: songs, feelings, tunings
   Pure data. Safe to unit-test in Node.
   ===================================================================== */
(function (root) {
  "use strict";

  // ---- Feelings -> scale/mode (the "vibe" engine) --------------------
  // Each maps to a default root + scale type. User can change the root.
  const FEELINGS = [
    { id: "happy",     label: "Happy / Bright",        emoji: "🎃", root: "C",  scale: "major",           blurb: "Open, uplifting, resolved." },
    { id: "sad",       label: "Sad / Melancholy",      emoji: "👻", root: "A",  scale: "minor",           blurb: "Reflective, heavy-hearted." },
    { id: "dark",      label: "Dark / Sinister",       emoji: "🦇", root: "E",  scale: "phrygian",        blurb: "Menacing, tense, Spanish-metal edge." },
    { id: "epic",      label: "Epic / Heroic",         emoji: "💀", root: "D",  scale: "mixolydian",      blurb: "Anthemic, bold, cinematic." },
    { id: "dreamy",    label: "Dreamy / Ethereal",     emoji: "🔮", root: "C",  scale: "lydian",          blurb: "Floating, magical, otherworldly." },
    { id: "bluesy",    label: "Bluesy / Soulful",      emoji: "🎭", root: "A",  scale: "blues",           blurb: "Gritty, expressive, swung." },
    { id: "mysterious",label: "Mysterious / Tense",    emoji: "🌙", root: "A",  scale: "harmonicMinor",   blurb: "Exotic, suspenseful, unresolved." },
    { id: "jazzy",     label: "Jazzy / Smooth",        emoji: "🧛", root: "D",  scale: "dorian",          blurb: "Sophisticated, cool, hip." },
    { id: "chill",     label: "Chill / Relaxed",       emoji: "🕸️", root: "G",  scale: "majorPentatonic", blurb: "Easy, no wrong notes, mellow." },
    { id: "angry",     label: "Angry / Aggressive",    emoji: "🩸", root: "E",  scale: "minorPentatonic", blurb: "Raw, driving, riff-ready." },
    { id: "evil",      label: "Evil / Exotic",         emoji: "😈", root: "E",  scale: "phrygianDominant",blurb: "Flamenco-meets-metal darkness." },
    { id: "hopeful",   label: "Hopeful / Warm",        emoji: "🕯️", root: "G",  scale: "major",           blurb: "Gentle optimism, sunrise feel." },
  ];

  // ---- Song database (key + mode) ------------------------------------
  // root = pitch class name, scale = scale id. feeling = vibe tag.
  const SONGS = [
    { title: "Hey Jude",                 artist: "The Beatles",        root: "F",  scale: "major", feeling: "hopeful" },
    { title: "Let It Be",                artist: "The Beatles",        root: "C",  scale: "major", feeling: "hopeful" },
    { title: "Blackbird",                artist: "The Beatles",        root: "G",  scale: "major", feeling: "chill" },
    { title: "Imagine",                  artist: "John Lennon",        root: "C",  scale: "major", feeling: "hopeful" },
    { title: "Hallelujah",               artist: "Leonard Cohen",      root: "C",  scale: "major", feeling: "sad" },
    { title: "Wonderwall",               artist: "Oasis",              root: "F#", scale: "minor", feeling: "sad" },
    { title: "Creep",                    artist: "Radiohead",          root: "G",  scale: "major", feeling: "sad" },
    { title: "Smells Like Teen Spirit",  artist: "Nirvana",            root: "F",  scale: "minor", feeling: "angry" },
    { title: "Come As You Are",          artist: "Nirvana",            root: "F",  scale: "minor", feeling: "dark" },
    { title: "Sweet Child O' Mine",      artist: "Guns N' Roses",      root: "D",  scale: "major", feeling: "happy" },
    { title: "Stairway to Heaven",       artist: "Led Zeppelin",       root: "A",  scale: "minor", feeling: "mysterious" },
    { title: "Nothing Else Matters",     artist: "Metallica",          root: "E",  scale: "minor", feeling: "sad" },
    { title: "Master of Puppets",        artist: "Metallica",          root: "E",  scale: "minor", feeling: "angry" },
    { title: "Enter Sandman",            artist: "Metallica",          root: "E",  scale: "minor", feeling: "dark" },
    { title: "Hotel California",         artist: "Eagles",             root: "B",  scale: "minor", feeling: "mysterious" },
    { title: "Seven Nation Army",        artist: "The White Stripes",  root: "E",  scale: "minor", feeling: "angry" },
    { title: "Back in Black",            artist: "AC/DC",              root: "E",  scale: "major", feeling: "epic" },
    { title: "Thunderstruck",            artist: "AC/DC",              root: "B",  scale: "major", feeling: "epic" },
    { title: "Smoke on the Water",       artist: "Deep Purple",        root: "G",  scale: "minor", feeling: "angry" },
    { title: "Sunshine of Your Love",    artist: "Cream",              root: "D",  scale: "minorPentatonic", feeling: "bluesy" },
    { title: "Layla",                    artist: "Derek & The Dominos",root: "D",  scale: "minor", feeling: "bluesy" },
    { title: "Paint It Black",           artist: "The Rolling Stones", root: "E",  scale: "minor", feeling: "dark" },
    { title: "Zombie",                   artist: "The Cranberries",    root: "E",  scale: "minor", feeling: "sad" },
    { title: "Wish You Were Here",       artist: "Pink Floyd",         root: "G",  scale: "major", feeling: "chill" },
    { title: "Crazy Train",              artist: "Ozzy Osbourne",      root: "F#", scale: "minor", feeling: "epic" },
    { title: "Iron Man",                 artist: "Black Sabbath",      root: "B",  scale: "minor", feeling: "dark" },
    { title: "Smooth",                   artist: "Santana",            root: "A",  scale: "minor", feeling: "bluesy" },
    { title: "Billie Jean",              artist: "Michael Jackson",    root: "F#", scale: "minor", feeling: "mysterious" },
    { title: "Beat It",                  artist: "Michael Jackson",    root: "E",  scale: "minor", feeling: "angry" },
    { title: "Africa",                   artist: "Toto",               root: "A",  scale: "major", feeling: "chill" },
    { title: "Take On Me",               artist: "a-ha",               root: "A",  scale: "major", feeling: "happy" },
    { title: "Don't Stop Believin'",     artist: "Journey",            root: "E",  scale: "major", feeling: "hopeful" },
    { title: "Sweet Home Alabama",       artist: "Lynyrd Skynyrd",     root: "D",  scale: "major", feeling: "happy" },
    { title: "Boulevard of Broken Dreams",artist:"Green Day",          root: "F",  scale: "minor", feeling: "sad" },
    { title: "Bohemian Rhapsody",        artist: "Queen",              root: "Bb", scale: "major", feeling: "epic" },
    { title: "Comfortably Numb",         artist: "Pink Floyd",         root: "B",  scale: "minor", feeling: "dreamy" },
    { title: "Riders on the Storm",      artist: "The Doors",          root: "E",  scale: "dorian",feeling: "jazzy" },
    { title: "So What",                  artist: "Miles Davis",        root: "D",  scale: "dorian",feeling: "jazzy" },
    { title: "Misirlou",                 artist: "Dick Dale",          root: "E",  scale: "phrygianDominant", feeling: "evil" },
    { title: "Tears in Heaven",          artist: "Eric Clapton",       root: "A",  scale: "major", feeling: "sad" },
  ];

  // ---- Additional artists (researched keys) --------------------------
  // Pink Floyd (incl. last-4-decades albums), Journey, Staind, Misery
  // Signals, The Acacia Strain, From Ashes to New. Drop-tuned metal uses
  // the riff's tonal center (lowest-string root) + a minor/phrygian scale.
  const MORE_SONGS = [
    // --- Pink Floyd ---
    { title: "Shine On You Crazy Diamond",       artist: "Pink Floyd", root: "G",  scale: "minor", feeling: "epic" },
    { title: "Money",                            artist: "Pink Floyd", root: "B",  scale: "blues", feeling: "bluesy" },
    { title: "Time",                             artist: "Pink Floyd", root: "F#", scale: "minor", feeling: "dark" },
    { title: "Breathe (In the Air)",             artist: "Pink Floyd", root: "E",  scale: "minor", feeling: "dreamy" },
    { title: "Us and Them",                      artist: "Pink Floyd", root: "D",  scale: "major", feeling: "dreamy" },
    { title: "Dogs",                             artist: "Pink Floyd", root: "D",  scale: "minor", feeling: "dark" },
    { title: "Pigs (Three Different Ones)",      artist: "Pink Floyd", root: "E",  scale: "minor", feeling: "angry" },
    { title: "Another Brick in the Wall, Pt. 2", artist: "Pink Floyd", root: "D",  scale: "minor", feeling: "angry" },
    { title: "Hey You",                          artist: "Pink Floyd", root: "E",  scale: "minor", feeling: "sad" },
    { title: "Mother",                           artist: "Pink Floyd", root: "A",  scale: "major", feeling: "sad" },
    { title: "The Final Cut",                    artist: "Pink Floyd", root: "C",  scale: "major", feeling: "sad" },
    { title: "Not Now John",                     artist: "Pink Floyd", root: "E",  scale: "minor", feeling: "angry" },
    { title: "Learning to Fly",                  artist: "Pink Floyd", root: "F#", scale: "minor", feeling: "hopeful" },
    { title: "On the Turning Away",              artist: "Pink Floyd", root: "G",  scale: "minor", feeling: "sad" },
    { title: "High Hopes",                       artist: "Pink Floyd", root: "D#", scale: "minor", feeling: "epic" },
    { title: "Marooned",                         artist: "Pink Floyd", root: "B",  scale: "minor", feeling: "dreamy" },
    { title: "Coming Back to Life",              artist: "Pink Floyd", root: "B",  scale: "major", feeling: "hopeful" },
    { title: "Louder Than Words",                artist: "Pink Floyd", root: "G",  scale: "major", feeling: "dreamy" },
    // --- Journey ---
    { title: "Faithfully",                       artist: "Journey",    root: "C",  scale: "major", feeling: "sad" },
    { title: "Separate Ways (Worlds Apart)",     artist: "Journey",    root: "E",  scale: "minor", feeling: "epic" },
    { title: "Open Arms",                        artist: "Journey",    root: "E",  scale: "major", feeling: "sad" },
    { title: "Any Way You Want It",              artist: "Journey",    root: "E",  scale: "major", feeling: "happy" },
    { title: "Wheel in the Sky",                 artist: "Journey",    root: "D",  scale: "minor", feeling: "epic" },
    { title: "Lights",                           artist: "Journey",    root: "G",  scale: "major", feeling: "chill" },
    { title: "Lovin', Touchin', Squeezin'",      artist: "Journey",    root: "E",  scale: "major", feeling: "bluesy" },
    { title: "Who's Crying Now",                 artist: "Journey",    root: "F#", scale: "minor", feeling: "sad" },
    // --- Staind ---
    { title: "It's Been Awhile",                 artist: "Staind",     root: "A",  scale: "minor", feeling: "sad" },
    { title: "Outside",                          artist: "Staind",     root: "E",  scale: "minor", feeling: "sad" },
    { title: "So Far Away",                      artist: "Staind",     root: "D",  scale: "major", feeling: "hopeful" },
    { title: "Right Here",                       artist: "Staind",     root: "E",  scale: "minor", feeling: "sad" },
    { title: "Mudshovel",                        artist: "Staind",     root: "A#", scale: "phrygian", feeling: "angry" },
    { title: "Fade",                             artist: "Staind",     root: "B",  scale: "minor", feeling: "dark" },
    { title: "For You",                          artist: "Staind",     root: "A#", scale: "minor", feeling: "angry" },
    // --- Misery Signals ---
    { title: "Of Malice and the Magnum Heart",   artist: "Misery Signals", root: "C",  scale: "phrygian", feeling: "angry" },
    { title: "The Failsafe",                     artist: "Misery Signals", root: "C",  scale: "phrygian", feeling: "dark" },
    { title: "A Certain Death",                  artist: "Misery Signals", root: "C",  scale: "minor", feeling: "dark" },
    { title: "Coma",                             artist: "Misery Signals", root: "C",  scale: "phrygian", feeling: "angry" },
    { title: "The Fall",                         artist: "Misery Signals", root: "C#", scale: "phrygian", feeling: "dark" },
    { title: "Ebb and Flow",                     artist: "Misery Signals", root: "C",  scale: "minor", feeling: "dark" },
    // --- The Acacia Strain ---
    { title: "Continent",                        artist: "The Acacia Strain", root: "A", scale: "phrygian", feeling: "evil" },
    { title: "Skynet",                           artist: "The Acacia Strain", root: "A", scale: "phrygian", feeling: "evil" },
    { title: "Beast",                            artist: "The Acacia Strain", root: "A", scale: "phrygian", feeling: "angry" },
    { title: "Whoa! Shut It Down!",              artist: "The Acacia Strain", root: "A", scale: "phrygian", feeling: "evil" },
    { title: "Dust and the Helping Hand",        artist: "The Acacia Strain", root: "F", scale: "phrygian", feeling: "evil" },
    { title: "Sensory Deprivation",              artist: "The Acacia Strain", root: "F", scale: "phrygian", feeling: "dark" },
    // --- From Ashes to New (interpreted from "from Harlem to Ashes") ---
    { title: "Through It All",                   artist: "From Ashes to New", root: "C",  scale: "minor", feeling: "hopeful" },
    { title: "Crazy",                            artist: "From Ashes to New", root: "D",  scale: "minor", feeling: "angry" },
    { title: "Panic",                            artist: "From Ashes to New", root: "E",  scale: "minor", feeling: "dark" },
    { title: "Nightmare",                        artist: "From Ashes to New", root: "F#", scale: "minor", feeling: "dark" },
    { title: "My Name",                          artist: "From Ashes to New", root: "E",  scale: "minor", feeling: "angry" },
    { title: "Until We Break",                   artist: "From Ashes to New", root: "A",  scale: "minor", feeling: "hopeful" },
  ];

  // ---- Guitar tunings (low string -> high string, with octave) -------
  const TUNINGS = [
    { id: "standard",  label: "Standard (E A D G B E)",       strings: ["E2", "A2", "D3", "G3", "B3", "E4"] },
    { id: "dropD",     label: "Drop D (D A D G B E)",         strings: ["D2", "A2", "D3", "G3", "B3", "E4"] },
    { id: "halfStep",  label: "Half Step Down (Eb)",          strings: ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"] },
    { id: "fullStep",  label: "Full Step Down (D)",           strings: ["D2", "G2", "C3", "F3", "A3", "D4"] },
    { id: "dropC",     label: "Drop C (C G C F A D)",         strings: ["C2", "G2", "C3", "F3", "A3", "D4"] },
    { id: "dropCs",    label: "Drop C# (C# G# C# F# A# D#)",   strings: ["C#2", "G#2", "C#3", "F#3", "A#3", "D#4"] },
    { id: "openG",     label: "Open G (D G D G B D)",         strings: ["D2", "G2", "D3", "G3", "B3", "D4"] },
    { id: "openD",     label: "Open D (D A D F# A D)",        strings: ["D2", "A2", "D3", "F#3", "A3", "D4"] },
    { id: "openE",     label: "Open E (E B E G# B E)",        strings: ["E2", "B2", "E3", "G#3", "B3", "E4"] },
    { id: "dadgad",    label: "DADGAD (D A D G A D)",         strings: ["D2", "A2", "D3", "G3", "A3", "D4"] },
  ];

  const Data = { FEELINGS, SONGS: SONGS.concat(MORE_SONGS), TUNINGS };
  root.NoirData = Data;
  if (typeof module !== "undefined" && module.exports) module.exports = Data;
})(typeof window !== "undefined" ? window : globalThis);
