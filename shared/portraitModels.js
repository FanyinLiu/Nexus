/**
 * Model files for the v0.5 portrait pipeline, with their provenance.
 *
 * None of these are bundled. They are downloaded on first use from a Nexus
 * GitHub Release, pinned by exact byte size and SHA-256, and shown to the
 * user together with their source and licence. The release
 * `portrait-models-v1` was published by the owner on 2026-10-02 with exactly
 * the assets listed in `docs/PORTRAIT_LANDMARK_MODELS.md`. Setting
 * `PORTRAIT_MODEL_RELEASE.published` back to false makes the downloader
 * refuse to run (`release_unpublished`).
 *
 * `trainingDataDocumented: false` means full provenance of the pinned weights
 * has not been verified; upstream may still document partial dataset sources.
 * `wired: false` marks a model that is planned but not used by the app yet;
 * the downloader skips it unless asked explicitly.
 */

const RELEASE_TAG = 'portrait-models-v1'

export const PORTRAIT_MODEL_RELEASE = Object.freeze({
  tag: RELEASE_TAG,
  baseUrl: `https://github.com/FanyinLiu/Nexus/releases/download/${RELEASE_TAG}`,
  published: true,
})

const releaseUrl = (fileName) => `${PORTRAIT_MODEL_RELEASE.baseUrl}/${fileName}`

export const PORTRAIT_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'anime-face-yolov3',
    role: 'detector',
    wired: true,
    fileName: 'anime_face_yolov3.onnx',
    sizeBytes: 246_035_424,
    sha256: 'f44b484f59c3aaf113c4dea57338163fef1c9e470bee7bcfd95a69ff1ed9f1a9',
    url: releaseUrl('anime_face_yolov3.onnx'),
    source: Object.freeze({
      name: 'hysts/anime-face-detector (YOLOv3)',
      url: 'https://huggingface.co/hysts/anime-face-detector-yolov3',
      revision: 'afdd4226a79ae8bb81f334dbcffd34f8cc000c38',
    }),
    license: Object.freeze({ spdx: 'MIT', url: 'https://github.com/hysts/anime-face-detector/blob/main/LICENSE' }),
    trainingDataDocumented: false,
  }),
  Object.freeze({
    id: 'anime-face-hrnetv2',
    role: 'landmarks',
    wired: true,
    fileName: 'anime_face_hrnetv2_flip.onnx',
    sizeBytes: 39_046_070,
    sha256: '3c2eb13d89cde5ab5b668de710bec81d08264f8db2df5200e6dd3fb7ecdadf54',
    url: releaseUrl('anime_face_hrnetv2_flip.onnx'),
    source: Object.freeze({
      name: 'hysts/anime-face-detector (HRNetV2 landmarks)',
      url: 'https://huggingface.co/hysts/anime-face-detector-hrnetv2',
      revision: '9b3435248b26aeb82e2a8578fe9d86d5d57158af',
    }),
    license: Object.freeze({ spdx: 'MIT', url: 'https://github.com/hysts/anime-face-detector/blob/main/LICENSE' }),
    trainingDataDocumented: false,
  }),
  Object.freeze({
    id: 'isnet-anime',
    role: 'cutout',
    wired: true,
    fileName: 'isnetis.onnx',
    sizeBytes: 176_069_933,
    sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99',
    url: releaseUrl('isnetis.onnx'),
    source: Object.freeze({
      name: 'SkyTNT/anime-segmentation (ISNet)',
      url: 'https://huggingface.co/skytnt/anime-seg',
      revision: '493cb60893f47441b26ec4fb9a306bce9e342982',
    }),
    license: Object.freeze({ spdx: 'Apache-2.0', url: 'https://github.com/SkyTNT/anime-segmentation/blob/main/LICENSE' }),
    trainingDataDocumented: false,
  }),
])

/**
 * Catalog entries for the given roles (default: every model the app uses now).
 * @param {{ includePlanned?: boolean }} [options]
 */
export function selectPortraitModels(options = {}) {
  return PORTRAIT_MODEL_CATALOG.filter((model) => model.wired || options.includePlanned === true)
}

/**
 * Renderer-safe attribution for a catalog entry (no URLs to fetch, no paths).
 * @param {(typeof PORTRAIT_MODEL_CATALOG)[number]} model
 */
export function describePortraitModel(model) {
  return {
    id: model.id,
    role: model.role,
    wired: model.wired,
    sizeBytes: model.sizeBytes,
    sourceName: model.source.name,
    sourceUrl: model.source.url,
    licenseSpdx: model.license.spdx,
    licenseUrl: model.license.url,
    trainingDataDocumented: model.trainingDataDocumented,
  }
}
