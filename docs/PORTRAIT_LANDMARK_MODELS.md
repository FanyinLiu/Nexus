# Portrait landmark models (v0.5 stage B)

Stage B of the portrait image gate (`electron/services/portraitGenerator/landmarkGate.js`)
runs an anime face detector and a 28-point landmark model on images that stage A
(`rejectImage.js`) accepted. This document covers where the models come from, how
they are found at runtime, and what is still undecided.

> **Status:** the models are **not** bundled and **not** downloaded by the app yet,
> and no ONNX runtime is wired. Until both happen, stage B reports
> `landmark_models_unavailable` and stage A's verdict stands. Nothing is rejected
> because of a missing model.

## Models

| role | file | size (bytes) | sha256 |
| --- | --- | --- | --- |
| detector | `anime_face_yolov3.onnx` | 246,035,424 | `f44b484f59c3aaf113c4dea57338163fef1c9e470bee7bcfd95a69ff1ed9f1a9` |
| landmarks | `anime_face_hrnetv2_flip.onnx` | 39,046,070 | `3c2eb13d89cde5ab5b668de710bec81d08264f8db2df5200e6dd3fb7ecdadf54` |

These values are pinned in `landmarkModels.js` (`LANDMARK_MODEL_FILES`). A file with a
different size or hash is reported as `invalid` and is never loaded.

**Upstream:** [hysts/anime-face-detector](https://github.com/hysts/anime-face-detector)
(MIT code). The PyTorch weights are the mmdet YOLOv3 face detector and the mmpose
HRNetV2 landmark model published in that project's GitHub releases. The licence for
redistributing those **weights** has not been reviewed yet; it must be reviewed
before Nexus hosts or bundles them.

**Export** (from the v0.5 spike, `round2/export_onnx.py`, opset 17):

- Detector: `image` `[1,3,H,W]` (RGB in [0,1], long side 608, zero-padded to a
  multiple of 32) → `p32`, `p16`, `p8` YOLO heads.
- Landmarks: `crops` `[N,3,256,256]` (ImageNet-normalised affine crops) → `heatmaps`
  `[N,28,64,64]`. Flip-test averaging is built into the graph.

The ONNX export matched PyTorch to within 0.03 px (round 2). The JS pre/post-processing
port (`animeFaceModel.js`) matched the Python ONNX pipeline on 47 spike images:
0 face-count mismatches and a mean keypoint error of 0.08% of face width.

## Where the app looks

`resolveLandmarkModelDirectory(userData)` → `<userData>/models/portrait-landmarks/`.

`createLandmarkModelLoader({ directory, createSession })` behaves as follows:

- It is lazy: no disk or runtime work happens until the first portrait check.
- A successful load is cached for the life of the process. A failure is not cached,
  so the next check retries.
- The status is one of `ready`, `missing`, `invalid`, `runtime_unavailable` (no
  `createSession` injected) or `load_failed`.

For a local developer test:

1. Run the spike export.
2. Copy both `.onnx` files into the directory above.
3. Inject an `onnxruntime-node` `InferenceSession.create` as `createSession`.

## Open decisions (owner)

1. **Runtime.** `onnxruntime-node` is only a transitive dependency today and is
   excluded from packaging. Choose a direct dependency and packaging (about 50 MB per
   platform), or run in the renderer through `onnxruntime-web`. `animeFaceModel.js`
   only needs `session.run(feeds) -> { name: { data, dims } }`, so either runtime fits.
2. **Distribution.** Choose between an optional download (a `MODEL_CATALOG` entry
   with a vetted URL plus the size/hash pins above) and bundling. 285 MB argues for an
   optional download. This needs the weights licence review first.
3. **Smaller detector.** The 246 MB YOLOv3 detector is the bulk of the download. A
   lighter face detector would need its own parity and dev round.
