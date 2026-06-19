# Known Issues — NOIR Studio

_Last reviewed: 2026-06-19 (post-Studio rebuild). Static vanilla-JS app, no build step._

## Network / Audio

1. **CDN dependency on first load.** Tone.js (`index.html`, cdnjs), the Salamander piano samples (`audio.js` → `tonejs.github.io/audio/salamander/`), the guitar/acoustic-drum samples (jsDelivr), and Google Fonts all load from the network. The app is non-functional offline until the browser has cached them. _Acknowledged in README._
2. **Synth fallback quality.** If the CDN is blocked, `audio.js` `_fallbackSynth()` swaps in a basic triangle/fmsine `PolySynth` after a ~9s timeout. It sounds markedly worse than the real samples and only a toast notifies the user.
3. **Browser audio-gating / `file://`.** Audio boots lazily on first click (`app.js` `startAudio`). Opening `index.html` directly via `file://` blocks cross-origin samples + autoplay — must be served (`python -m http.server 8777`, or the desktop shortcut). _Acknowledged in README._
4. **Piano samples not bundled.** Guitar samples are self-hosted under `samples/`, but piano still depends on the CDN. Full offline use is incomplete.
5. **Acoustic drum kit depends on the CDN.** `drums.js` lazy-loads acoustic drum one-shots from jsDelivr; any voice that fails/times out falls back to the synthesized electronic kit. The electronic kit is fully offline.
6. **KB JSON fetch can silently degrade.** `kb.js` fetches `music-teacher-kb.json` / `music-teacher-knowledge.json` at runtime; on `file://` or fetch failure, Metal Dude falls back to the embedded cards only and loses the extended knowledge.

## Integrations

7. **OpenAI integration is BYO-key & unvalidated.** `nathan.js` (Metal Dude) POSTs to `api.openai.com` (gpt-4o-mini) with a user-pasted key stored in plaintext `localStorage`. No key validation, no rate-limit/cost guard. Falls back to the offline KB on any error. Optional — no network call unless a key is added.

## Studio / not-yet-verified

8. **Visual device QA pending.** The overlap/z-index + responsive pass was done structurally (z-index ladder, scroll-clearance for the floating widgets, phone repositioning, wrapping tabs, horizontal-scroll sequencer). It has **not** been click-tested on a real iPad/iPhone — worth a hands-on spot-check on touch.
9. **Large-session performance unverified.** 12 tracks + a full 8-minute Song arrangement with many clips/drum sequences has not been load-tested; Tone.Transport scheduling could need tuning at the extremes.
10. **No audio export yet.** Studio Song/Loop output can't be rendered to `.wav` (would need `Tone.Recorder`). Listed as a next step.

## Resolved (kept for history)

- **`parallelMinor()`** — now correct: `theory.js` returns the same tonic respelled for the minor context (parallel minor shares the tonic). No longer a stub.
- **README song-count drift** — fixed; database is 91 songs (`data.js`).
- **`.nexus/` / `ARCHIVE/` artifacts** — now in `.gitignore`; the repo is tracked and pushed to `DBTRHR/noir-studio`.
