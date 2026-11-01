"""
OmniVoice OpenAI-compatible TTS server.

Wraps k2-fsa/OmniVoice into an OpenAI /v1/audio/speech endpoint
so Nexus can use it as an openai-compatible TTS provider.

Usage:
    python scripts/omnivoice_server.py [--port 8000] [--model k2-fsa/OmniVoice]
"""

SIDECAR_VERSION = "1"

import argparse
import io
import logging
import struct
import threading

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from nexus_sidecar_guard import (
    MAX_JSON_BODY_BYTES,
    authorize_request,
    require_sidecar_token,
)
from omnivoice import OmniVoice

logger = logging.getLogger(__name__)

app = FastAPI()
model = None
model_lock = threading.Lock()
sampling_rate = 24000
_SIDECAR_TOKEN = ""


@app.middleware("http")
async def nexus_sidecar_guard(request: Request, call_next):
    failure = authorize_request(
        token=_SIDECAR_TOKEN,
        method=request.method,
        headers=request.headers,
        content_types=("application/json",),
        max_body_bytes=MAX_JSON_BODY_BYTES,
    )
    if failure:
        status, message = failure
        return JSONResponse(status_code=status, content={"error": {"message": message}})
    return await call_next(request)


def get_best_device():
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def encode_pcm(audio_tensor, sr):
    """Encode audio tensor to raw PCM int16 bytes."""
    audio = audio_tensor.squeeze().cpu()
    if audio.dtype == torch.float32 or audio.dtype == torch.float16:
        audio = audio.float().clamp(-1.0, 1.0)
        audio = (audio * 32767).to(torch.int16)
    return audio.numpy().tobytes()


def encode_wav(audio_tensor, sr):
    """Encode audio tensor to WAV bytes."""
    buf = io.BytesIO()
    torchaudio.save(buf, audio_tensor.cpu(), sr, format="wav")
    return buf.getvalue()


VALID_INSTRUCT_ITEMS = {
    # English
    "american accent", "australian accent", "british accent", "canadian accent",
    "child", "chinese accent", "elderly", "female", "high pitch", "indian accent",
    "japanese accent", "korean accent", "low pitch", "male", "middle-aged",
    "moderate pitch", "portuguese accent", "russian accent", "teenager",
    "very high pitch", "very low pitch", "whisper", "young adult",
}


def parse_speaker_attributes(raw: str) -> str | None:
    """Parse speaker-identity attributes only (accent/gender/age/pitch).

    This comes from the pinned `voice` field. It must never absorb the emotion
    prose from `instructions`, or a per-sentence tone would silently replace
    the speaker and change the timbre mid-reply.
    """
    if not raw:
        return None
    # Check if all comma-separated items are valid English instructs
    items = [item.strip().lower() for item in raw.replace("，", ",").split(",") if item.strip()]
    if not items:
        return None
    # If any item looks like a valid instruct keyword, use it; otherwise skip
    valid = [item for item in items if item in VALID_INSTRUCT_ITEMS]
    if valid:
        return ", ".join(valid)
    # Could be Chinese speaker words — pass through if it contains CJK characters
    if any("\u4e00" <= ch <= "\u9fff" for ch in raw):
        return raw
    return None


def normalize_emotion_instruction(raw: str) -> str | None:
    """Keep the renderer's per-sentence tone prose instead of dropping it.

    Nexus sends natural-language Chinese (e.g. "带点傲娇，语气轻快") rather than
    keyword instructions. OmniVoice accepts free-form instruct text, so it is
    passed through (whitespace-normalized and bounded) as a separate clause.
    """
    if not raw:
        return None
    text = " ".join(raw.split())
    return text[:240] or None


@app.post("/v1/audio/speech")
async def audio_speech(request: Request):
    raw_body = await request.body()
    try:
        import json as _json
        body = _json.loads(raw_body.decode("utf-8"))
    except UnicodeDecodeError:
        body = _json.loads(raw_body.decode("utf-8", errors="replace"))

    text = str(body.get("input", "")).strip()
    if not text:
        return Response(content="missing input text", status_code=400)

    speed = float(body.get("speed", 1.0))
    voice = str(body.get("voice", "")).strip()
    response_format = str(body.get("response_format", "wav")).strip().lower()
    instructions = str(body.get("instructions", "")).strip()

    # Nexus sends a stable `seed` derived from the streaming session's
    # requestId so every segment in a multi-sentence reply pins the same
    # diffusion initial noise — otherwise the speaker latent re-rolls on every
    # call and users hear the voice switch between sentences. Missing/invalid
    # seed falls back to the previous non-deterministic behaviour.
    seed_raw = body.get("seed")
    seed: int | None = None
    if seed_raw is not None:
        try:
            seed = int(seed_raw) & 0x7FFFFFFF
        except (TypeError, ValueError):
            seed = None

    # Speaker attributes (pinned voice) and emotion prose (per sentence) are
    # separate inputs. Joining them keeps the timbre fixed while letting the
    # tone change: one never replaces the other.
    speaker_instruct = parse_speaker_attributes(voice)
    emotion_instruct = normalize_emotion_instruction(instructions)
    instruct = ", ".join(
        part for part in (speaker_instruct, emotion_instruct) if part
    ) or None

    logger.info(
        f"TTS request: text={text[:60]}... speed={speed} voice={voice} "
        f"speaker_instruct={speaker_instruct} emotion_instruct={emotion_instruct} "
        f"seed={seed}"
    )

    with model_lock:
        if seed is not None:
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)
        audios = model.generate(
            text=text,
            instruct=instruct,
            speed=speed,
            num_step=32,
            guidance_scale=2.0,
            t_shift=0.1,
            denoise=True,
            postprocess_output=True,
        )

    audio = audios[0]  # shape: [1, num_samples]

    if response_format == "pcm":
        pcm_bytes = encode_pcm(audio, sampling_rate)
        return Response(content=pcm_bytes, media_type="application/octet-stream")
    else:
        wav_bytes = encode_wav(audio, sampling_rate)
        return Response(content=wav_bytes, media_type="audio/wav")


@app.get("/v1/models")
async def list_models():
    return {
        "data": [
            {"id": "tts-1", "object": "model"},
            {"id": "tts-1-hd", "object": "model"},
        ]
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "omnivoice"}


def main():
    global model, sampling_rate, _SIDECAR_TOKEN

    parser = argparse.ArgumentParser(description="OmniVoice OpenAI-compatible TTS server")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--model", type=str, default="k2-fsa/OmniVoice")
    parser.add_argument("--device", type=str, default=None)
    args = parser.parse_args()

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(filename)s:%(lineno)d] %(message)s",
        level=logging.INFO,
    )

    _SIDECAR_TOKEN = require_sidecar_token()

    device = args.device or get_best_device()
    logger.info(f"Loading OmniVoice from {args.model} on {device} ...")
    model = OmniVoice.from_pretrained(args.model, device_map=device, dtype=torch.float16)
    sampling_rate = model.sampling_rate
    logger.info(f"Model loaded. Sample rate: {sampling_rate}. Starting server on {args.host}:{args.port}")

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
