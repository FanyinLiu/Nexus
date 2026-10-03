# Portrait models (v0.5): landmark gate and cutout

Stage B of the portrait image gate (`electron/services/portraitGenerator/landmarkGate.js`)
runs an anime face detector and a 28-point landmark model on images that stage A
(`rejectImage.js`) accepted. Portrait drafts (`portraitDraft.js`) also run an anime
cutout model before layering.
This document covers where the models come from, how the app downloads, verifies and
runs them, and what the owner still has to do.

> **Status:** nothing is bundled. The app downloads the models on first use from the
> Nexus GitHub Release
> [`portrait-models-v1`](https://github.com/FanyinLiu/Nexus/releases/tag/portrait-models-v1)
> (published 2026-10-02, not marked latest), and `PORTRAIT_MODEL_RELEASE.published`
> in `shared/portraitModels.js` is `true`. The download is user-initiated, never
> automatic. Until the files are installed, stage B reports
> `landmark_models_unavailable` and stage A's verdict stands. Nothing is rejected
> because of a missing model. Setting `published` back to `false` makes the
> downloader refuse to run (`release_unpublished`).

## Models and attribution

Release tag: **`portrait-models-v1`**. The pinned URL is
`https://github.com/FanyinLiu/Nexus/releases/download/portrait-models-v1/<file>`.

| id | role | file | size (bytes) | sha256 | used by the app |
| --- | --- | --- | --- | --- | --- |
| `anime-face-yolov3` | face detector | `anime_face_yolov3.onnx` | 246,035,424 | `f44b484f59c3aaf113c4dea57338163fef1c9e470bee7bcfd95a69ff1ed9f1a9` | yes (stage B) |
| `anime-face-hrnetv2` | 28 face landmarks | `anime_face_hrnetv2_flip.onnx` | 39,046,070 | `3c2eb13d89cde5ab5b668de710bec81d08264f8db2df5200e6dd3fb7ecdadf54` | yes (stage B) |
| `isnet-anime` | character cutout | `isnetis.onnx` | 176,069,933 | `f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99` | yes (portrait drafts) |

| id | upstream source (pinned revision) | licence |
| --- | --- | --- |
| `anime-face-yolov3` | <https://huggingface.co/hysts/anime-face-detector-yolov3> @ `afdd4226a79ae8bb81f334dbcffd34f8cc000c38` (weights of [hysts/anime-face-detector](https://github.com/hysts/anime-face-detector) v0.0.1) | MIT, Copyright (c) 2021 hysts |
| `anime-face-hrnetv2` | <https://huggingface.co/hysts/anime-face-detector-hrnetv2> @ `9b3435248b26aeb82e2a8578fe9d86d5d57158af` (same project) | MIT, Copyright (c) 2021 hysts |
| `isnet-anime` | <https://huggingface.co/skytnt/anime-seg> @ `493cb60893f47441b26ec4fb9a306bce9e342982` (`isnetis.onnx`, from [SkyTNT/anime-segmentation](https://github.com/SkyTNT/anime-segmentation)) | Apache-2.0 |

**Training-data provenance is undocumented** for all three models. The upstream cards
publish the weights as-is and do not describe their training images. This is recorded
as `trainingDataDocumented: false` in the catalog, and any UI that shows model
information must say so.

All of this is pinned in `shared/portraitModels.js` (`PORTRAIT_MODEL_CATALOG`).
`landmarkModels.js` derives `LANDMARK_MODEL_FILES` from it. A file with a different
size or hash is `invalid` and is never loaded. `pet-model:portrait-models-status`
returns the attribution (source, licence, training-data flag, size) plus the install
state, so the future portrait UI can show it before asking the user to download. No
UI shows it yet.

### Conversion

The face models come from the spike's `round2/export_onnx.py` (opset 17), run on the
original PyTorch weights (mmdet YOLOv3, mmpose HRNetV2):

- Detector: `image` `[1,3,H,W]` (RGB in [0,1], long side 608, zero-padded to a
  multiple of 32) → `p32`, `p16`, `p8` YOLO heads.
- Landmarks: `crops` `[N,3,256,256]` (ImageNet-normalised affine crops) → `heatmaps`
  `[N,28,64,64]`. Flip-test averaging is built into the graph.

The ONNX export matched PyTorch to within 0.03 px (round 2). The JS pre/post-processing
(`animeFaceModel.js`) matched the Python ONNX pipeline on 47 spike images: 0
face-count mismatches and a mean keypoint error of 0.08% of face width.
`isnetis.onnx` is redistributed byte-identical to the upstream file. The release
README records how the release files were re-checked under `onnxruntime-web`.

## Download (first use)

`portraitModelDownloader.js` (IPC `pet-model:download-portrait-models`, panel window
only, audited; progress on `pet-model:portrait-models-progress`) behaves as follows:

- Downloads all three models into `<userData>/models/portrait-landmarks/` (the
  directory name predates the cutout), about 461 MB in total.
- Every request and redirect goes through the shared model-download allowlist
  (`modelDownloadSecurity.js`): HTTPS only, GitHub release hosts included.
- Resumes `<file>.partial` with an HTTP `Range` request. The bytes already on disk
  are re-hashed, and a server that ignores `Range` restarts the file.
- Retries network errors, stalls (60 s without data), 5xx and 429 up to 4 attempts,
  with 1 s / 4 s / 10 s backoff. A SHA-256 mismatch deletes the partial file and
  retries once from zero. A wrong size or an unsafe redirect fails immediately.
- The file is moved into place only after its size and SHA-256 match. Errors are
  stable codes (`release_unpublished`, `http_status`, `network`, `stalled`,
  `size_mismatch`, `hash_mismatch`, `aborted`, `disk`, `unsafe_url`) and never
  include paths or URLs.

## Runtime

`landmarkRuntime.js` runs `onnxruntime-web` (WASM, CPU) in a dedicated
`worker_threads` worker (`landmarkWorker.js`), so loading and inference never block
the main process or the companion windows:

- `prepare()` checks the model files (size + SHA-256, remembered per process by
  path, size and mtime) and that the WASM files can be found.
- `evaluate()` starts a fresh worker per image, transfers the raster, and always
  terminates the worker afterwards. `session.release()` does not return WASM
  memory; terminating the worker does. Jobs are serialised, and a job is abandoned
  after 180 s (`timeout`).
- Measured in Node 22 on the dev box: about 2 s to load both models, about 1.8 s per
  image with 4 WASM threads (about 6 s with 1), and 0.8–1 GB RSS in the worker
  (about 1.5 GB peak in the round-2 measurement). Threads default to
  `min(4, cores - 1)`.

Packaging: `package.json` `build.files` keeps only
`onnxruntime-web/dist/{ort.node.min.mjs, ort-wasm-simd-threaded.mjs, ort-wasm-simd-threaded.wasm}`
(about 12 MB) plus `onnxruntime-common`. These stay inside `app.asar`. Electron's asar
support covers the WASM read and the loader's thread workers; this was verified in a
packaged `electron-builder --linux dir` build, including 4 threads. Nothing is
unpacked, so the `app.asar.unpacked` size budget is unaffected. `npm run heavy:audit`
fails if `build.files` excludes any of these files.

For a local developer test, copy the files from the spike (or from the release
assets) into `<userData>/models/portrait-landmarks/`. No code changes are needed.

## Cutout (portrait drafts)

`portraitDraft.js` runs: stage A -> cutout -> landmarks -> layers.

- The cutout runs only when the image is not already transparent (at least 5% of
  pixels with alpha < 26 keeps the image's own alpha, `cutout.status:
  skipped_transparent`). Face models are checked first, so a missing landmark model
  stops before any cutout work.
- `cutoutStage.js` decodes with sharp (EXIF-rotated, **embedded ICC profile ignored**,
  alpha dropped; only images above 4096 px are pre-shrunk) and sends the RGB raster to
  the worker as a separate job (`task: 'cutout'`, fresh worker, same lock as the
  landmark jobs, so two model heaps never coexist).
- `cutoutModel.js` follows the spike's `cutout.py`: squash to 1024x1024, divide by the
  image maximum, subtract the ImageNet mean (std 1), run `isnetis.onnx`, min-max
  normalise the first output, truncate to 0..255, resize to the layer working size.
  Both resizes use a port of Pillow's Lanczos (bit-exact against Pillow 12.3.0 on the
  dev images).
- Landmarks still run on the original pixels. The gate thresholds were tuned on
  uncut images.
- There is no plain-background fallback (v0.5: when unsure, reject). A missing or
  damaged model (face models or cutout) stops generation with
  `portrait_models_not_downloaded` ("download the models first"). Any other cutout
  failure (runtime unavailable, load failure, worker error or timeout) or an untrusted
  mask (foreground share outside 1-99%, `empty`) rejects the image with
  `background_not_separable` ("use a plain or transparent background"); `detail`
  carries the cutout status. Codes and message keys live in `shared/portraitDraft.js`.
  Accepted drafts record `alphaSource` (`image` / `cutout`) and `cutout.status`.

Parity with the spike (113 dev images, onnxruntime-web 1.24.3 in the worker vs
Python onnxruntime 1.30.0 with Pillow 12.3.0): max absolute difference 1/255 on every image,
for both the 1024x1024 mask and the original-size alpha; at most 0.0004% of pixels
change side of 0.5; minimum IoU 0.99995. Before the Pillow resampler and the ICC fix,
sharp's Lanczos flipped up to 7.8% of pixels on ambiguous images, and colour
management flipped 33% on an ICC-tagged photo.

Measured full pipeline in Node 22 on the 8-core dev box, 4 WASM threads
(`round7_cutout/pipeline_bench.mjs`): 10.4-12.9 s per opaque image (cutout job
5.2-6.9 s including worker start and the 176 MB model load, landmarks 3.5-6.7 s,
layers 0.2-1.5 s), 4.5-5.5 s for transparent inputs. Peak process RSS 1.16-1.54 GB.
Between jobs, glibc keeps the terminated workers' malloc arenas (RSS plateaus around
0.6 GB on Linux; 240-270 MB with `MALLOC_ARENA_MAX=2`); the JS heap stays at 7 MB.

## Gate rules added after the stage 1-4 acceptance (2593532)

The frozen acceptance at 2593532 failed (a chibi reported as "hands near face",
two hand-at-chin images and a faded background figure accepted, a real photo
rejected only by luck). These rules were added; all follow "when unsure, reject".
Thresholds live in `PORTRAIT_LANDMARK_GATE_LIMITS` (`landmarkGate.js`) and
`PORTRAIT_BACKGROUND_RESIDUAL_LIMITS` (`backgroundResidual.js`). The face-size limit
(96 px) is unchanged.

- **Second character** (`multiple_characters`, "0.5 只支持单人"): every detection
  with score > 0.5 and at least 20% of the largest face's size counts (the face
  picker for landmarks still uses 40%). A faded or oversized background face, which
  the picker may even prefer over the real face, still makes the count two.
- **Photo** (`photo_not_illustration`): no extra model; two texture statistics on the
  detected face. (1) `flat`: the face box resampled to 128x128 grey, share of pixels
  with Sobel |gx|+|gy| <= 4. Cel/anime shading leaves large exactly-flat areas; camera
  skin does not. Below 0.05 is a photo. (2) `skinGrain`: the face rescaled to 120 px
  wide, in the cheek skin (own skin between brows and mouth) away from strokes, the
  share of pixels with |Laplacian of L| >= 1.5. If `flat` < 0.10 and `skinGrain`
  >= 0.40 it is a photo. Known gap: a well-lit, smooth-skinned photo can pass
  (1 of 6 dev photos does); stage A's busy-background check still catches most
  photos with a real background.
- **Chibi** (`half_body_only`, detail `chibi`), checked before every hand check: the
  largest foreground component containing the face (alpha, else "not the border
  colour", on a <= 256 px mask) ends at least 3% of the image height above the
  bottom edge, is at most 5 face-box heights tall, and the mean width of its bottom
  10% rows is at most 0.35 of its widest row (feet, not a cut-off bust).
- **Hand at the chin or mouth** (`hands_near_face`, detail `chin_hidden` /
  `hand_at_chin`): chin landmark confidence < 0.6 (a hand over the chin breaks the
  chin point; good dev images are >= 0.68), or more than 3.5% of the box under the
  chin (+-0.3 face widths, chin + 0.03..0.35 face heights) is thin valleys between
  lit own skin (finger separations). A hand over the mouth is still caught by
  `mouth_covered` first.
- **Busy interior behind a plain border** (generation path, opaque images, after
  the cutout; `busy_background`, stage `cutout`, detail `background_residual`):
  outside the isnet mask dilated by 3% of the long side, reject if more than 5% of
  pixels differ from the dominant background colour by > 24 (any channel), or more
  than 4% have a 7x7 grey local std > 6. The faded close-up behind the character in
  the acceptance set is not found by the face detector at any usable score, so this
  rule, not the face count, is what rejects it.

## Owner checklist before release

1. ~~Create the GitHub Release `portrait-models-v1`~~ Done 2026-10-02: the three files
   above plus `SHA256SUMS`, both licence texts, the provenance README and
   `export_onnx.py`. The release assets must never be replaced in place; a changed
   model needs a new tag and new pins.
2. ~~Set `PORTRAIT_MODEL_RELEASE.published = true`~~ Done.
3. Decide where the portrait UI shows the download consent and the attribution
   table.
4. Run a fresh frozen acceptance round (20 images, at least 2 good dark-skinned
   characters) before release.
