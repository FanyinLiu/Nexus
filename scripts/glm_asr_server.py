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

import argparse
import io
import logging
import os
import tempfile
import threading

import torch
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="GLM-ASR-Nano STT Server")
model = None
processor = None
model_lock = threading.Lock()


def get_best_device():
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_best_dtype(device):
    if device == "cuda" and torch.cuda.get_device_capability()[0] >= 8:
        return torch.bfloat16
    return torch.float16


def load_model(model_id, device, dtype):
    global model, processor
    from transformers import AutoModelForSeq2SeqLM, AutoProcessor

    logger.info("Loading processor from %s ...", model_id)
    processor = AutoProcessor.from_pretrained(model_id)

    logger.info("Loading model from %s on %s (%s) ...", model_id, device, dtype)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        model_id, torch_dtype=dtype, device_map=device,
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
    return {"status": "ok", "model_loaded": model is not None}


def main():
    parser = argparse.ArgumentParser(description="GLM-ASR-Nano STT Server")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--host", default="127.0.0.1")
    # Try ModelScope cache first, then fall back to HuggingFace ID
    ms_cache = os.path.expanduser("~/.cache/modelscope/hub/ZhipuAI/GLM-ASR-Nano-2512")
    default_model = ms_cache if os.path.isdir(ms_cache) else "zai-org/GLM-ASR-Nano-2512"
    parser.add_argument("--model", default=default_model)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    device = get_best_device()
    dtype = get_best_dtype(device)
    load_model(args.model, device, dtype)

    logger.info("Starting server on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
