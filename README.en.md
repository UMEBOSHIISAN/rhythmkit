# rhythmkit — a falling-note kit for learning real instruments

> **日本語**: [README.md](README.md)

> Beatmania-style notes fall down the screen, and you hit them by playing the **correct pitch on a real instrument** picked up through the microphone — a kids' instrument-learning game kit. The first game built on it is "Ume Bass!" (bass learning).
> Contract source of truth: [SPEC.md](SPEC.md).
>
> rhythmkit is a zero-dependency, single-file HTML rhythm-game kit for learning real instruments: falling notes are judged by **pitch-detecting your actual instrument through the microphone** (autocorrelation/NSDF, down to bass E1 = 41.2 Hz). Instruments, songs and games are plug-in data files — no engine changes needed. Japanese kid-friendly UI. MIT licensed.

## What it can do

- **Practice mode**: notes stop at the judge line and wait until you play the correct pitch (no misses, take as long as you like). This is the main mode for actual learning.
- **Rhythm mode**: standard rhythm-game judging (PERFECT/GOOD/"almost!", combo, rank S–C). **No game over** — you always play through to the end and the result screen is always positive (the design goal is practice, not failure).
- **Tuner mode**: shows the detected note name plus a cents meter. Usable for tuning the instrument.
- **Finger position guide** (v1.1): a fretboard diagram (a keyboard diagram for piano) is shown at all times below the judge line. The note to play right now pulses with the fret number on it (open string reads "open" in Japanese); the next note is shown as a ghost outline dot. String colors match the lane colors above.
- Best-score 🏆 saved to `localStorage`, combo cheers, confetti on the result screen.
- Three input methods: **live mic performance** (pitch detection, down to the bass's lowest note E1 = 41.2 Hz) / on-screen tap / keyboard (for development).
- Falls back automatically to tap play in environments where the mic isn't available.
- **Privacy**: mic audio is only pitch-analyzed on-device — nothing is recorded, stored, or sent anywhere. The app makes zero network calls (verifiable with `grep "http" dist/`).

## Parts structure

```
build.py            Assembly: python3 build.py <game_id> → dist/<game_id>/index.html (deterministic, stdlib only)
template.html       CSS/DOM skeleton + viewport (portrait iPhone first)
engine/             Generic parts (zero instrument-specific knowledge)
  audio_synth.js      Procedural Web Audio synthesis (preview notes/SFX/metronome/iOS unlock)
  pitch_detector.js   Mic → pitch detection (NSDF autocorrelation + parabolic interpolation; echoCancellation etc. forced OFF)
  input_router.js     mic/touch/keyboard → unified input events
  highway.js          Falling-note rendering (variable lane count 4/6/8, gradient background/glow effects)
  fingerboard.js      Finger position guide (fretboard/keyboard diagram, branches on INSTRUMENT_DEF.display)
  judge.js            Judging (timing × pitch, wait mode, scoring)
  hud.js              Score/combo/mic level/tuner rendering
  game_core.js        Registry + state machine (title→micSetup→play→result / tuner)
instruments/        INSTRUMENT_DEF (1 instrument = 1 file) — bass / guitar / piano
charts/             CHART (song data) — 10 bundled songs (open strings / do-re-mi / Tulip / Twinkle Twinkle Little Star, etc.)
games/<id>/game.js  GAME_DEF (theme, included songs, character)
tests/              Node-run verification suite (pitch-detection accuracy / content consistency / judge logic)
```

Three-layer contract: **adding an instrument = 1 file in `instruments/` / adding a song = 1 `registerChart` call / making a new game = 1 file in `games/`.** The engine itself is never touched.

## Build & run

```bash
cd rhythmkit
python3 build.py umebass        # → dist/umebass/index.html (96KB, single file)
```

- All you need is Python 3 (standard library only, no extra packages). npm/node is only needed to run the tests.
- `umebass` is a **game_id** (= a directory name under `games/`). Create `games/mygame/game.js` and build it with `python3 build.py mygame`.
- Just double-click to open it on a Mac (the mic isn't available over `file://`, so it falls back to tap play).
- **HTTPS hosting is required to use the mic on iPhone** (a `getUserMedia` requirement). Deploy to something like pages.dev.
- Verification: `node tests/test_pitch.js && node tests/test_content.js && node tests/test_smoke_judge.js`

## Add a new song (5 minutes)

Append one block to `charts/charts_basic.js` (or drop a new `charts_xxx.js` file directly under `charts/` — just adding the file is enough for the build to pick it up).
`registerChart` / `registerInstrument` are **global functions provided by the engine** (no import/require — build.py concatenates all sources into one HTML file):

```js
registerChart({
  id: 'mysong', title: 'A New Song', level: 2,
  bpm: 90, countInBeats: 4,
  notes: [            // beat = beats from the start of the song / midi = actual pitch (the instrument maps it to a lane)
    { beat: 0, midi: 36 },          // C2
    { beat: 1, midi: 43 },          // G2
    { beat: 2, midi: 36, len: 2 },  // len = display length in beats (defaults to 1)
  ],
  range: { min: 36, max: 43 },      // pitch range used (grayed out on the song-select screen if outside the instrument's range)
});
```

Run `python3 build.py umebass` and it's done. **A song written for bass plays just as well on piano/guitar** (because the note-to-lane mapping lives on the instrument side).

## Add a new instrument (10 minutes)

Create `instruments/ukulele.js` (example):

```js
const INSTRUMENT_UKULELE = {
  id: 'ukulele', label: 'Ukulele', emoji: '🎶',
  judgeModes: ['pitch', 'lane'],
  defaultJudgeMode: 'pitch',
  lanes: [   // display lanes (top to bottom). Color = note color for that lane
    { id:'A', label:'A', openMidi:69, color:'#f6c945' },
    { id:'E', label:'E', openMidi:64, color:'#6fd66f' },
    { id:'C', label:'C', openMidi:60, color:'#5db4f0' },
    { id:'G', label:'G', openMidi:67, color:'#ef8bb0' },
  ],
  midiRange: { min: 60, max: 81 },
  mic: { fmin: 200, fmax: 1200, clarityMin: 0.83, levelMin: 0.01 },
  noteToLane(midi) { /* return midi → {laneIndex, fret} — copy the same function from instruments/bass.js as a starting point */ },
  pitchTolerance: 'pitchClass',   // allow octave mismatches ('exact' for strict matching)
  synthPatch: 'guitar',           // preview timbre (a key into audio_synth.js; add new timbres to SYNTH_PATCHES)
};
registerInstrument(INSTRUMENT_UKULELE);
```

Then add `'ukulele'` to `instruments: ['bass','guitar','piano']` in `games/umebass/game.js` and build.

## Make a different game

Write one GAME_DEF file at `games/<newid>/game.js` and run `python3 build.py <newid>`. Theme colors, included songs, title, and cheer lines all swap out (same idea as catchkit's GAME_DEF contract).

## iPhone/audio design decisions (breaking these breaks the app)

| Decision | Reason |
|---|---|
| `echoCancellation`/`noiseSuppression`/`autoGainControl` all OFF in `getUserMedia` | iOS's AEC treats instrument sound as "noise" and kills it — turning it ON makes low notes disappear |
| `AudioContext` creation and `getUserMedia` happen inside a tap handler | iOS Safari's autoplay restrictions |
| `fftSize=4096` + NSDF autocorrelation + `fmin=35Hz` | Bass E1 (41.2Hz) has a ~24ms period; 4096 samples @ 44.1kHz gives about 4 full periods |
| `pitchTolerance` defaults to `'pitchClass'` | Bass has strong harmonics that cause octave misdetection, so octave mismatches are accepted as correct for kids |
| Judge windows PERFECT ±0.18s / GOOD ±0.35s + `offsetSec` default -0.12s | Absorbs mic + processing latency (50–150ms measured on real iOS devices); fine-tunable with a slider in settings |
| Time axis is `AudioContext.currentTime` | rAF timestamps drift out of sync with audio |

## Tests

```bash
node tests/test_pitch.js        # Pitch-detection accuracy (synthetic 41.2/55/110/220Hz waves, within ±1Hz)
node tests/test_content.js      # Consistency of 3 instruments × 10 songs / 717 notes (ascending beats / range / mapping / fret ≤ 7)
node tests/test_smoke_judge.js  # 17 judge-logic checks
node tests/test_waitclock.js    # Practice-mode clock stop/resume
node tests/test_boot_smoke.js   # DOM-stub boot smoke test on the built output
```

## Verification status (2026-07-11, v1.1)

- Pitch-detection accuracy: near-0Hz error and clarity 1.0 on synthetic 41.2/55/110/220Hz waves
- Content consistency: all mappings pass for 3 instruments × 10 songs / 717 notes (fretboard display range fret ≤ 7 guaranteed)
- 17 judge-logic checks, 5 wait-clock checks, 7 boot-smoke checks — all passing
- Deterministic build: identical sha256 across two consecutive builds (96KB single HTML file)
- **Mic judging on a real iPhone is still awaiting a hands-on test** (synthetic-waveform verification is done; how it handles real room acoustics and string muting can only be known on a real device)

## License

MIT
