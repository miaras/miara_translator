# Shiroko: Read beyond the page

26-second launch film with an original synthesized score, English → Japanese side-by-side translation, and Korean → English book-photo transcription and translation.

Exports: `exports/launch-features-{16x9,1x1,9x16}.mp4`, H.264/AAC, 30 fps, 1920×1080 / 1080×1080 / 1080×1920. Seven inspection frames accompany each format.

The film uses a designed, animated product demonstration with prepared text, rather than a recording of a live OCR or translation request. `content.json` includes the supplied Moby-Dick passage in full with a Japanese translation, and transcribed excerpts with English translations from each selected book page. Book excerpts are labeled on screen; the film does not claim to display the complete page text. The original photos are shown intact.

Selected photos, in ascending filename order:

1. `20260821_173718.jpg` — printed page 52
2. `20260821_173722.jpg` — printed page 53
3. `20260821_173724.jpg` — printed page 54

`20260821_173454.jpg` is excluded as requested.

## Edit and score

The score is locked before picture at 120 BPM. Product reveal: 6.0 seconds. Side-by-side demonstration: 6–12 seconds. Three book photos: 12–22 seconds, one at a time in filename order. Benefit card: 22–23.5 seconds. Final brand accent and still CTA hold: 23.5–26 seconds.

The HTML composition draws deterministically from a supplied timestamp. Every encoded frame is explicitly drawn at frame / 30; there are no wall-clock animation timers. Each aspect has its own layout. Long text scrolls inside its panel.

## Render on another computer

Use Node.js 20+, Python 3, and the fonts Liberation Serif, IPAPGothic, and WenQuanYi Zen Hei. Ubuntu/Debian font packages are `fonts-liberation`, `fonts-ipafont-gothic`, and `fonts-wqy-zenhei`. On other systems, install those fonts for matching typography.

From your checkout:

```sh
cd video/launch-features
npm install
npx playwright install chromium
# Linux: if browser system libraries are missing, use:
# npx playwright install --with-deps chromium
npm run stills
# Inspect exports/*.jpg before encoding.
npm run render
npm run verify
```

FFmpeg is included through `ffmpeg-static`. The render command generates the soundtrack automatically using Python's standard library. No API credentials or paid translation requests are needed.

The renderer writes full-resolution JPEG frames to `.render/`, recycles Chromium every 120 frames, and closes the browser before FFmpeg encoding to reduce memory use. A failed render can resume using completed frames. After editing text or composition, run `npm run render -- --fresh` to replace cached frames. Allow roughly 1 GB of temporary disk space for all formats. Completed MP4s are renamed into place only after successful encoding.

To render just one format:

```sh
LAUNCH_ASPECTS=16x9 npm run render
```

Optional environment variables: `PLAYWRIGHT_MODULE` (alternate module path), `FFMPEG` (alternate executable), `PYTHON` (defaults to `python3`), `LAUNCH_OUTPUT_DIR`, `LAUNCH_WORK_DIR`, and `LAUNCH_ASPECTS` (comma-separated `16x9,1x1,9x16`). Absolute paths are recommended for overrides.

Source photos are included under `assets/`. Generated previews, music, temporary frames, dependencies, and videos are ignored by Git. The existing website and launch film are unchanged.

Inspection frames from the initial composition were reviewed in all three aspects. The portable renderer received syntax and source-content checks only; a full encode was deliberately not run after the user requested script-only delivery.
