# Side-by-side launch film

A 23-second launch film made from a real screen recording of Shiroko translating the supplied opening of *Moby-Dick* into French, comparing the aligned sentences, and editing the first translation. The footage is video throughout; no browser screenshots are used.

The original synth score is designed first at 120 BPM: the product reveal lands at 6 seconds, and the end card holds from 20–23 seconds. The same moving footage is reframed into landscape, square, and portrait compositions. The homepage uses the landscape master.

Source files:

- `passage.txt`: the exact supplied passage.
- `make-score.py`: deterministic, original soundtrack; no third-party music.
- `film-process.mjs`: records actual browser interaction and one live translation.
- `edit-footage.mjs`: cuts and time-remaps recorded footage to the shot plan.
- `stage.html`: animated composition, real moving footage, and end card.
- `render-film.mjs`: records the compositions as video streams.

The pipeline requires Node.js, Python 3, Playwright with Chromium, and FFmpeg with H.264/AAC support. It keeps raw footage and intermediate renders in `LAUNCH_WORK_DIR` (default `/tmp/shiroko-launch`). Set `PLAYWRIGHT_MODULE` and `FFMPEG` when those tools are installed outside the project. No dependencies are added to the website runtime.

```sh
python3 video/launch/make-score.py
node video/launch/film-process.mjs
node video/launch/edit-footage.mjs
node video/launch/render-film.mjs
node video/launch/encode-film.mjs
python3 video/launch/make-logo-resolve.py
python3 video/launch/make-score-final.py
node video/launch/render-logo-outro.mjs
node video/launch/verify-film.mjs
```

The base intro uses 30fps H.264, an original AAC soundtrack, an exact 23-second cut, and fast-start metadata. The final assembly replaces the first end card with the morph, delivering a 26-second film. The poster is a decoded frame from the finished film. Captions and the text walkthrough remain available on the homepage. Screen recording is resized during composition to fit the render server’s memory budget, then exported at 1920×1080, 1080×1080, and 1080×1920.

## A → み logo ending

The published exports run 26 seconds: the first 20 seconds of the introduction followed by a six-second frame-exact vector morph. Latin A becomes hiragana み, then settles into the merged A/み logo. The final card holds for more than two seconds, with the original colors, tagline, and URL. A C-minor musical resolve at 120 BPM accompanies the ending; the brand settles on the 3.5-second beat in the appended segment.

`logo-outro.html` draws each frame deterministically from its time in seconds. `render-logo-outro.mjs --stills` exports inspection frames for all three aspects; omit `--stills` to encode standalone morph clips and append them to the original intros. `make-logo-resolve.py` generates the original audio tail. Run it before rendering. `LAUNCH_OUTRO_DIR` defaults to `/tmp/shiroko-logo-outro`; preserved intro masters there prevent repeated appends. To rebuild on a new machine, supply the original 23-second intro masters as `intro-original-{16x9,1x1,9x16}.mp4` in that directory. Standalone landscape clip: `public/demo/shiroko-logo-morph.mp4`; square/portrait clips: `exports/logo-morph-{1x1,9x16}.mp4`.

## Final 26-second edit

The delivered intro removes the original first end card: keep frames 0–599 (0–20s), append the six-second morph, and end at exactly 26 seconds / 780 frames. `make-score-final.py` creates one continuous 26-second score: original reveal at 6s, morph at 20s, and final logo accent at 23.5s. There is no audio splice at the 20s picture cut. `assemble-film.mjs` rebuilds all three final formats from preserved originals and rendered silent morph masters; no new browser render is needed for editorial or soundtrack changes. The standalone six-second morph clips remain available. Captions follow the new cut.

```sh
python3 video/launch/make-score-final.py
node video/launch/assemble-film.mjs
node video/launch/verify-film.mjs
```
