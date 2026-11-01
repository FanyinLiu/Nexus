"""
GLM-ASR-Nano OpenAI-compatible STT server.

Wraps zai-org/GLM-ASR-Nano-2512 into an OpenAI /v1/audio/transcriptions
endpoint so Nexus can use it as a custom-openai-stt provider.

Requirements:
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
    pip install "transformers>=5.0.0" soundfile fastapi uvicorn python-multipart

Usage:
    python scripts/glm_asr_server.py [--port 8000] [--model zai-org/GLM-ASR-Nano-2512]

Then in Nexus settings:
    - STT provider: 自定义 OpenAI 兼容 STT
    - Base URL: http://localhost:8000/v1
    - Model: glm-asr-nano (or anything, ignored by this server)
"""

SIDECAR_VERSION = "1"

import argparse
import io
import logging
import os
import tempfile
import threading
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from nexus_sidecar_guard import (
    MAX_AUDIO_BODY_BYTES,
    authorize_request,
    require_sidecar_token,
)

logger = logging.getLogger(__name__)

# Full commit SHA for zai-org/GLM-ASR-Nano-2512. Local ModelScope/Hugging Face
# directories are loaded offline instead; a Hub id must never fall back to the
# floating main branch. Override with --model-revision or
# NEXUS_GLM_ASR_MODEL_REVISION.
GLM_ASR_DEFAULT_REVISION = "61ba4e0b3309b6656edea3e93e419f7bd5c61957"
GLM_ASR_REVISION_ENV = "NEXUS_GLM_ASR_MODEL_REVISION"

app = FastAPI(title="GLM-ASR-Nano STT Server")
model = None
processor = None
model_lock = threading.Lock()
_SIDECAR_TOKEN = ""


@app.middleware("http")
async def nexus_sidecar_guard(request, call_next):
    failure = authorize_request(
        token=_SIDECAR_TOKEN,
        method=request.method,
        headers=request.headers,
        content_types=("multipart/form-data",),
        max_body_bytes=MAX_AUDIO_BODY_BYTES,
    )
    if failure:
        status, message = failure
        return JSONResponse(status_code=status, content={"error": {"message": message}})
    return await call_next(request)


def hf_cache_snapshot(model_id, revision=None):
    """Return a cached Hugging Face snapshot directory for `model_id`."""
    cache_root = Path(os.environ.get("HF_HOME") or (Path.home() / ".cache" / "huggingface")) / "hub"
    snapshots = cache_root / ("models--" + str(model_id).replace("/", "--")) / "snapshots"
    if revision:
        candidate = snapshots / str(revision)
        if candidate.is_dir():
            return candidate
    try:
        candidates = sorted(
            (entry for entry in snapshots.iterdir() if entry.is_dir()),
            key=lambda entry: entry.name,
            reverse=True,
        )
    except OSError:
        candidates = []
    return candidates[0] if candidates else None


def resolve_pretrained_source(model_id, revision):
    """Return (source, kwargs) for a pinned, offline-first from_pretrained call."""
    expanded = Path(str(model_id)).expanduser()
    if expanded.is_dir():
        return str(expanded), {"local_files_only": True}
    snapshot = hf_cache_snapshot(model_id, revision)
    if snapshot is not None:
        return str(snapshot), {"local_files_only": True}
    if not revision:
        raise RuntimeError(
            f"{model_id} is not cached locally and no pinned revision is configured; "
            f"set {GLM_ASR_REVISION_ENV} or --model-revision to a full commit SHA."
        )
    return str(model_id), {"revision": str(revision), "local_files_only": False}


def get_best_device():
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_best_dtype(device):
    if device == "cuda" and torch.cuda.get_device_capability()[0] >= 8:
        return torch.bfloat16
    return torch.float16


def load_model(model_id, device, dtype, revision=None):
    global model, processor
    from transformers import AutoModelForSeq2SeqLM, AutoProcessor

    source, load_kwargs = resolve_pretrained_source(model_id, revision)

    logger.info("Loading processor from %s ...", source)
    processor = AutoProcessor.from_pretrained(source, **load_kwargs)

    logger.info("Loading model from %s on %s (%s) ...", source, device, dtype)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        source, torch_dtype=dtype, device_map=device, **load_kwargs,
    )
    logger.info("Model loaded successfully.")


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default="", alias="model"),
    language: str = Form(default=""),
):
    """OpenAI Whisper-compatible transcription endpoint."""
    audio_bytes = await file.read()

    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(audio_bytes)
        tmp.close()

        with model_lock:
            inputs = processor.apply_transcription_request(tmp.name)
            inputs = inputs.to(model.device, dtype=model.dtype)

            with torch.inference_mode():
                outputs = model.generate(
                    **inputs, do_sample=False, max_new_tokens=1000,
                )

            text = processor.batch_decode(
                outputs[:, inputs.input_ids.shape[1]:],
                skip_special_tokens=True,
            )[0].strip()
    finally:
        os.unlink(tmp.name)

    logger.info("Transcribed %d bytes -> %d chars", len(audio_bytes), len(text))
    return JSONResponse({"text": text})


@app.get("/v1/models")
async def list_models():
    return JSONResponse({
        "object": "list",
        "data": [{"id": "glm-asr-nano", "object": "model"}],
    })


@app.get("/health")
async def health():
    return {"status": "ok", "service": "glm-asr", "model_loaded": model is not None}


def main():
    global _SIDECAR_TOKEN
    parser = argparse.ArgumentParser(description="GLM-ASR-Nano STT Server")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--host", default="127.0.0.1")
    # Try ModelScope cache first, then fall back to HuggingFace ID
    ms_cache = os.path.expanduser("~/.cache/modelscope/hub/ZhipuAI/GLM-ASR-Nano-2512")
    default_model = ms_cache if os.path.isdir(ms_cache) else "zai-org/GLM-ASR-Nano-2512"
    parser.add_argument("--model", default=default_model)
    parser.add_argument(
        "--model-revision",
        default=os.environ.get(GLM_ASR_REVISION_ENV) or GLM_ASR_DEFAULT_REVISION,
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    _SIDECAR_TOKEN = require_sidecar_token()

    device = get_best_device()
    dtype = get_best_dtype(device)
    load_model(args.model, device, dtype, args.model_revision)

    logger.info("Starting server on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
