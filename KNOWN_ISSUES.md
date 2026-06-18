# Known Issues — NOIR Studio

_Last reviewed: 2026-06-18 (CCREVIEW). Static vanilla-JS app, ~3,400 LOC, no build step._

## Network / Audio

1. **CDN dependency on first load.** Tone.js (`index.html`, cdnjs), the Salamander piano samples (`audio.js` → `tonejs.github.io/audio/salamander/`), and Google Fonts all load from the network. The app is non-functional offline until the browser has cached them. _Acknowledged in README._
2. **Synth fallback quality.** If the CDN is blocked, `audio.js` `_fallbackSynth()` swaps in a basic triangle/fmsine `PolySynth` after a ~9s timeout. It sounds markedly worse than the real samples and only a toast notifies the user.
3. **Browser audio-gating / `file://`.** Audio boots lazily on first click (`app.js` `startAudio`). Opening `index.html` directly via `file://` blocks cross-origin samples + autoplay — must be served (`python -m http.server 8777`). _Acknowledged in README._
4. **Piano samples not bundled.** Guitar samples are self-hosted under `samples/`, but piano still depends on the CDN. Full offline use (listed as a "next step" in README) is incomplete.
5. **KB JSON fetch can silently degrade.** `kb.js` fetches `music-teacher-kb.json` / `music-teacher-knowledge.json` at runtime; on `file://` or fetch failure, Nathan falls back to the embedded cards only and loses the extended knowledge.

## Integrations

6. **OpenAI integration is BYO-key & unvalidated.** `nathan.js` POSTs to `api.openai.com` (gpt-4o-mini) with a user-pasted key stored in plaintext `localStorage`. No key validation, no rate-limit/cost guard. Falls back to the offline KB on any error. Optional — no network call unless a key is added.

## Code

7. **`parallelMinor()` is a stub.** `theory.js` returns the root unchanged — a functional placeholder.

## Docs / Repo hygiene

8. **README song-count drift.** _Fixed 2026-06-18:_ README said "40-song database"; actual is 91 (`data.js`).
9. **`.nexus/` is a generated artifact.** The indexed code-graph + wiki (kuzu DB, ~17MB) lives in `noir-studio/.nexus/`. If this project becomes its own tracked git repo, add `.nexus/` and `ARCHIVE/` to `.gitignore`.
