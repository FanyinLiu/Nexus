# Portrait models (v0.5): landmark gate and planned cutout

Stage B of the portrait image gate (`electron/services/portraitGenerator/landmarkGate.js`)
runs an anime face detector and a 28-point landmark model on images that stage A
(`rejectImage.js`) accepted. The v0.5 layering will also use an anime cutout model.
This document covers where the models come from, how the app downloads, verifies and
runs them, and what the owner still has to do.

> **Status:** nothing is bundled. The app downloads the models on first use from a
> Nexus GitHub Release. **That release does not exist yet.** `PORTRAIT_MODEL_RELEASE`
> in `shared/portraitModels.js` is a placeholder with `published: false`. Until the
> owner publishes the assets below under that exact tag and flips the flag, the
> downloader refuses to run (`release_unpublished`). Stage B then reports
> `landmark_models_unavailable` and stage A's verdict stands. Nothing is rejected
> because of a missing model.

## Models and attribution

Release tag: **`portrait-models-v1`**. The pinned URL is
`https://github.com/FanyinLiu/Nexus/releases/download/portrait-models-v1/<file>`.

| id | role | file | size (bytes) | sha256 | used by the app |
| --- | --- | --- | --- | --- | --- |
| `anime-face-yolov3` | face detector | `anime_face_yolov3.onnx` | 246,035,424 | `f44b484f59c3aaf113c4dea57338163fef1c9e470bee7bcfd95a69ff1ed9f1a9` | yes (stage B) |
| `anime-face-hrnetv2` | 28 face landmarks | `anime_face_hrnetv2_flip.onnx` | 39,046,070 | `3c2eb13d89cde5ab5b668de710bec81d08264f8db2df5200e6dd3fb7ecdadf54` | yes (stage B) |
| `isnet-anime` | character cutout | `isnetis.onnx` | 176,069,933 | `f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99` | planned (`wired: false`) |

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

- Downloads into `<userData>/models/portrait-landmarks/`. The wired models total
  about 285 MB. `isnet-anime` is skipped until cutout is wired.
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

## Owner checklist before release

1. Create the GitHub Release `portrait-models-v1` with exactly the three files above
   plus `SHA256SUMS`, the licence texts and the provenance README (prepared locally,
   not uploaded).
2. Set `PORTRAIT_MODEL_RELEASE.published = true` in a PR.
3. Decide where the portrait UI shows the download consent and the attribution
   table.
4. Run a fresh frozen acceptance round (20 images, at least 2 good dark-skinned
   characters) before release.
