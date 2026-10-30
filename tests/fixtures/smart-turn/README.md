# Smart Turn v3 fixtures

- `mel-reference.json` — Whisper-Tiny log-mel reference produced with
  `transformers==4.57.6` `WhisperFeatureExtractor(chunk_length=8)` and the
  same `do_normalize=True` / last-8-seconds path as pipecat's
  `smart-turn/inference.py`. The test regenerates the deterministic input
  signal in `tests/smart-turn-features.test.ts` and compares 22 sampled
  frames plus global min/max/mean (tolerance 1e-4). 80 bins × 800 frames.
- `turn-complete.wav` / `turn-open.wav` — 16 kHz mono PCM16 clips generated
  locally with macOS `say` (Samantha) for `npm run voice:turn:bench` only.
  They are not used by unit tests and contain no personal audio.
