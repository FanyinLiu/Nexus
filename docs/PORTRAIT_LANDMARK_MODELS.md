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
- There is no plain-background fallback. A missing or damaged model (face models
  or cutout) stops generation with `portrait_models_not_downloaded` ("download the
  models first"). Any other cutout failure (runtime unavailable, load failure,
  worker error or timeout) or an empty mask (foreground share outside 1-99%,
  `empty`) rejects the image with `background_not_separable`; `detail` carries the
  cutout status. Codes and message keys live in `shared/portraitDraft.js`.
  Accepted drafts record `alphaSource` (`image` / `cutout`) and `cutout.status`.
- Busy backgrounds are not refused before generation any more (the old
  post-cutout "background residual" rule and stage A's border rule are gone): the
  output is judged instead, see below.

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

## Generate first, then judge the output (v0.5 round 3 design)

Before generation only what generation cannot use is refused. Everything about
the result is judged on the generated draft, and the user still sees a preview
and must accept it.

**Stage A** (`rejectImage.js`, before any model): unreadable, `decode_failed`,
`unsupported_format`, `animated`, `file_too_large` (> 256 MiB),
`dimensions_too_large` (> 268,402,689 px). Large images are downscaled, not
refused (files > 32 MiB are decoded by libvips from the path; anything > 32 MiB or
64 MP becomes a 4096 px lossless working copy).

**Stage B before generation** (`landmarkGate.js`, `PORTRAIT_LANDMARK_GATE_LIMITS`),
first match wins:

| Check | Rule | Reason (detail) |
| --- | --- | --- |
| No face | none with score > 0.5 after a contrast retry | `half_body_only` (`no_face`) |
| Second character | another face with score > 0.5 at >= 0.5 x the largest face's size | `multiple_characters` |
| Face too small | < 96 px (original pixels) | `half_body_only` (`face_small`) |
| Broken eye landmarks | eye spacing > 1 face width or an eye outside the outline | `eyes_unclear` (`eye_landmarks_broken`) |
| True side profile | contour symmetry < 0.33 or eye spacing < 0.38 | `side_view` |
| Full body | figure (largest foreground part holding the face) > 5.6 face-box heights | `half_body_only` (`full_body`) |

Removed before generation: the 90%-border plain-colour rule, blur, small image,
aspect ratio, chibi, hand at the chin / hands near the face, the post-cutout
background residual, a small second face in the background, and the photo test
(moved after generation because it called a textured illustration a photo). The
mouth evidence (landmark confidence < 0.3 after one retry, nose < mouth < chin
order < 0.06, an object across the mouth) is still measured here and passed on as
`mouthCheck`.

**After generation** (`portraitQuality.js`, `PORTRAIT_QUALITY_LIMITS`, stage
`quality`, nothing is written on failure), first failure wins:

| Check | Rule | Reason (detail) |
| --- | --- | --- |
| Cutout covers the face | alpha covers < 0.90 of the landmark face polygon | `background_not_separable` (`face_not_covered`) |
| Cutout in one piece | largest connected part < 0.80 of the foreground | `background_not_separable` (`fragmented`) |
| Photo | on the cut-out face (background painted white) at stage B resolution: flat share < 0.05, or < 0.10 with skin grain >= 0.40 | `photo_not_illustration` |
| Mouth landmarks | `mouthCheck` set (a hand over the mouth lands here) | `mouth_unreliable` (`mouth_landmarks_missing` / `landmark_order` / `object_across_mouth`) |
| Three layers | head < 0.03, body < 0.03 or hair < 0.02 of the foreground; < 0.85 of the visible face in the head layer | `layers_incomplete` (`missing_head` / `missing_body` / `missing_hair` / `face_split`) |
| Breathing frame | holes > 0.6 face units (see below) | `breathing_holes` |

Breathing frame (as the spike's `round4/breath.py`, without the tilt and the
horizontal stretch): body stretched vertically by 3% about the figure's bottom
row, head lifted by the body's displacement at the split row, hair with the head
above the split and blended to the body over 0.5 face heights below it. The body
counts as filled behind hair lying between body pixels of a row (gaps up to 0.6
face widths) and under the chin. A hole is a pixel that was opaque and is
uncovered with coverage both above and below within 2 x lift + 2 rows; the hole
area is in face units (face width x face height).

Known gaps: chibi has no dedicated rule (a chibi passes unless its output fails
a check); a well-lit smooth photo can still pass the texture test; a second
character the detector does not find is only caught if the cutout keeps it as a
separate part.

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
