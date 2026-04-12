# sherpa-models

This directory holds the local Sherpa-onnx model bundles used by the offline STT
and wake-word engines. The actual model files are large (~2 GB total) and are
**not** committed to git — they are downloaded on demand.

## Auto-download (Windows)

Run `setup.bat` from the repo root. It will fetch every model below into this
directory and skip ones that already exist.

## Manual download

If `setup.bat` cannot reach HuggingFace / ModelScope, or you are on macOS /
Linux, clone the bundles directly:

```bash
cd sherpa-models

# Streaming Paraformer ASR (中英 / 粤语, ~1.1 GB)
git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en

# English wake-word KWS (~15 MB)
git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01

# Chinese wake-word KWS (~32 MB)
git clone --depth 1 https://huggingface.co/csukuangfj/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01
```

ModelScope mirrors are available at the same paths under
`https://www.modelscope.cn/models/csukuangfj/<bundle-name>` if HuggingFace is
unreachable from your network.

## Layout

After downloading, this directory should look like:

```
sherpa-models/
  sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en/
    encoder.int8.onnx
    decoder.int8.onnx
    tokens.txt
  sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/
    encoder-epoch-12-avg-2-chunk-16-left-64.onnx
    ...
  sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/
    encoder-epoch-99-avg-1-chunk-16-left-64.onnx
    ...
```

The Sherpa STT engine adapter in `src/features/hearing/` reads from these paths
at runtime; if a bundle is missing, that engine simply becomes unavailable in
settings and the cloud STT providers continue to work.
