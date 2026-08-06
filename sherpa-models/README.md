# sherpa-models

This directory holds the local Sherpa-onnx model bundles used by the offline STT
and wake-word engines. The actual model files are large (~2 GB total) and are
**not** committed to git — they are downloaded on demand.

The authoritative model list is the `MODEL_CATALOG` constant in
`electron/services/modelDefinitions.js` — it owns the bundle directory names,
download sources, and integrity hashes, and is not duplicated here.

## Auto-download (Windows)

Run `setup.bat` from the repo root. It will fetch every model in the catalog
into this directory and skip ones that already exist.

## Manual download

If `setup.bat` cannot reach HuggingFace / ModelScope, or you are on macOS /
Linux, clone each bundle from the HuggingFace repo named by its `MODEL_CATALOG`
entry (`hfRepo`, or the `githubArchive` URL for `archive` entries):

```bash
cd sherpa-models
git clone --depth 1 https://huggingface.co/<hfRepo from MODEL_CATALOG>
```

ModelScope mirrors are available at the same paths under
`https://www.modelscope.cn/models/csukuangfj/<bundle-name>` if HuggingFace is
unreachable from your network.

## Layout

After downloading, this directory contains one subdirectory per `MODEL_CATALOG`
entry, named after the entry's `directory` field and holding the engine files
listed under its `checkFile` / `files` fields.

The Sherpa STT engine adapter in `src/features/hearing/` reads from these paths
at runtime; if a bundle is missing, that engine simply becomes unavailable in
settings and the cloud STT providers continue to work.
