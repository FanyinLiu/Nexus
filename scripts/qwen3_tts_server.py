"""Qwen3-TTS local speech sidecar.

Wraps a Qwen3-TTS CustomVoice checkpoint behind an OpenAI-compatible
`/v1/audio/speech` endpoint so Nexus can play speech without leaving the
machine. Synthesis is deliberately sentence-by-sentence: the model is slower
than real time on Apple silicon, so the first sentence is written to the
response as soon as it is ready and the rest follow while it plays.

Only stdlib HTTP is used here so the sidecar starts without FastAPI/uvicorn.
The model itself is loaded on the first request (or `/v1/warmup`) and every
load + generation runs under one lock — MPS/CUDA cannot share a model safely.
"""

SIDECAR_VERSION = "1"

import argparse
import json
import logging
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from nexus_sidecar_guard import (
    MAX_JSON_BODY_BYTES,
    authorize_request,
    require_sidecar_token,
)

logger = logging.getLogger("qwen3_tts")

DEFAULT_MODEL_DIR = (
    Path.home() / "Models" / "qwen3-tts" / "Qwen3-TTS-12Hz-1.7B-CustomVoice"
)
SAMPLE_RATE = 24000
MAX_SENTENCE_CHARS = 120

# Pinned Hub revision for the optional "pass a Hub id" path. Local directories
# are loaded with local_files_only=True instead, so an already-downloaded
# checkpoint never touches the network. Override with
# NEXUS_QWEN3_TTS_MODEL_REVISION or --model-revision to test another commit.
QWEN3_TTS_DEFAULT_REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe"
QWEN3_TTS_REVISION_ENV = "NEXUS_QWEN3_TTS_MODEL_REVISION"

# Known CustomVoice speakers. The loaded model is the source of truth; this
# list keeps `/health` and `/v1/speakers` answerable before the first load.
KNOWN_SPEAKERS = [
    "aiden",
    "dylan",
    "eric",
    "ono_anna",
    "ryan",
    "serena",
    "sohee",
    "uncle_fu",
    "vivian",
]

LANGUAGE_ALIASES = {
    "zh": "Chinese",
    "zh-cn": "Chinese",
    "zh-tw": "Chinese",
    "zh-hk": "Chinese",
    "chinese": "Chinese",
    "中文": "Chinese",
    "cmn": "Chinese",
    "en": "English",
    "en-us": "English",
    "en-gb": "English",
    "english": "English",
    "ja": "Japanese",
    "ja-jp": "Japanese",
    "japanese": "Japanese",
    "日本語": "Japanese",
    "ko": "Korean",
    "ko-kr": "Korean",
    "korean": "Korean",
    "한국어": "Korean",
    "fr": "French",
    "fr-fr": "French",
    "french": "French",
    "de": "German",
    "de-de": "German",
    "german": "German",
    "es": "Spanish",
    "es-es": "Spanish",
    "spanish": "Spanish",
    "it": "Italian",
    "it-it": "Italian",
    "italian": "Italian",
    "pt": "Portuguese",
    "pt-br": "Portuguese",
    "portuguese": "Portuguese",
    "ru": "Russian",
    "ru-ru": "Russian",
    "russian": "Russian",
    "auto": "Auto",
}

_model = None
_model_device = None
_model_error = None
_model_lock = threading.Lock()
_model_dir = str(DEFAULT_MODEL_DIR)
_model_revision = QWEN3_TTS_DEFAULT_REVISION
_SIDECAR_TOKEN = ""


def hf_cache_snapshot(model_id, revision=None):
    """Return a cached Hugging Face snapshot directory for `model_id`.

    Prefers an explicit revision, then the newest snapshot on disk. Loading the
    snapshot path with local_files_only=True keeps an already-downloaded model
    completely offline instead of re-resolving the floating main branch.
    """
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


def resolve_pretrained_source(model, revision):
    """Return (source, kwargs) for a pinned, offline-first from_pretrained call."""
    expanded = Path(str(model)).expanduser()
    if expanded.is_dir():
        return str(expanded), {"local_files_only": True}
    snapshot = hf_cache_snapshot(model, revision)
    if snapshot is not None:
        return str(snapshot), {"local_files_only": True}
    if not revision:
        raise RuntimeError(
            f"{model} is not cached locally and no pinned revision is configured; "
            f"set {QWEN3_TTS_REVISION_ENV} or --model-revision to a full commit SHA."
        )
    return str(model), {"revision": str(revision), "local_files_only": False}


def pick_device():
    """Prefer CUDA, then MPS, then CPU — matching the verified local setup."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def load_model_locked():
    """Load the checkpoint once. Caller MUST hold `_model_lock`."""
    global _model, _model_device, _model_error

    if _model is not None:
        return _model

    import torch
    from qwen_tts import Qwen3TTSModel

    device = pick_device()
    dtype = torch.float32 if device == "cpu" else torch.float16
    started = time.monotonic()
    source, load_kwargs = resolve_pretrained_source(_model_dir, _model_revision)
    logger.info("Loading Qwen3-TTS from %s on %s (%s) ...", source, device, dtype)
    try:
        _model = Qwen3TTSModel.from_pretrained(
            source,
            device_map=device,
            dtype=dtype,
            **load_kwargs,
        )
    except Exception as error:  # noqa: BLE001 - reported to the caller as 503
        _model_error = f"{type(error).__name__}: {error}"
        logger.exception("Model load failed")
        raise
    _model_device = device
    _model_error = None
    logger.info(
        "Model loaded in %.1fs on %s. Speakers: %s",
        time.monotonic() - started,
        device,
        get_speakers_locked(),
    )
    return _model


def get_speakers_locked():
    """Return model speakers, or the static list before the model is loaded."""
    model = _model
    if model is not None:
        try:
            speakers = model.get_supported_speakers()
            if speakers:
                return [str(name) for name in speakers]
        except Exception:  # noqa: BLE001 - health must stay answerable
            logger.exception("Could not read supported speakers")
    return list(KNOWN_SPEAKERS)


def resolve_language(raw, supported=None):
    """Map Nexus locale codes (zh-CN, en-US, …) to Qwen's language names."""
    value = str(raw or "").strip()
    candidate = LANGUAGE_ALIASES.get(value.lower(), value)
    if not candidate:
        candidate = "Auto"
    if supported:
        supported_lookup = {str(item).lower(): str(item) for item in supported}
        matched = supported_lookup.get(candidate.lower())
        if matched:
            return matched
        auto = supported_lookup.get("auto")
        if auto:
            return auto
        return supported[0]
    return candidate


def split_sentences(text):
    """Split reply text into speakable sentences without losing punctuation.

    The model is not real-time, so smaller units matter: the caller hears the
    first sentence while later ones are still being generated. Boundaries are
    CJK sentence punctuation, question/exclamation marks, semicolons, and
    newlines. A trailing fragment is merged so we never synthesize "。".
    """
    cleaned = str(text or "").strip()
    if not cleaned:
        return []

    raw_parts = re.split(r"(?<=[。！？!?；;…])|(?<=[.!?])(?=\s|$)|\n+", cleaned)
    pieces = []
    buffer = ""
    for part in raw_parts:
        fragment = part.strip()
        if not fragment:
            continue
        buffer = f"{buffer}{fragment}" if buffer else fragment
        # Very short fragments ("嗯。", "好的？") read better joined to a
        # neighbour than synthesized on their own.
        if len(buffer) < 6:
            continue
        pieces.extend(_split_long_sentence(buffer))
        buffer = ""
    if buffer:
        pieces.extend(_split_long_sentence(buffer))

    return [piece for piece in pieces if piece.strip()]


def _split_long_sentence(sentence):
    """Break one over-long sentence at commas/spaces, keeping punctuation."""
    if len(sentence) <= MAX_SENTENCE_CHARS:
        return [sentence]

    parts = re.split(r"(?<=[，,、：:])|\s+", sentence)
    output = []
    buffer = ""
    for part in parts:
        if not part:
            continue
        if buffer and len(buffer) + len(part) > MAX_SENTENCE_CHARS:
            output.append(buffer)
            buffer = part
        else:
            buffer = f"{buffer}{part}" if buffer else part
    if buffer:
        output.append(buffer)
    return output


def encode_pcm16(wav):
    """Convert a float waveform (numpy array) to little-endian int16 PCM."""
    import numpy as np

    samples = np.asarray(wav, dtype=np.float32).reshape(-1)
    if not samples.size:
        return b""
    samples = np.clip(samples, -1.0, 1.0)
    return (samples * 32767.0).round().astype("<i2").tobytes()


def seed_everything(seed):
    """Seed every generator the sampler can touch. Caller MUST hold the lock.

    Qwen3-TTS re-rolls its sampling noise on every call, so the same sentence
    came out at 212/218/242/257 Hz on four consecutive runs and neighbouring
    sentences sounded like different people. Pinning the seed makes one request
    reproducible while different sentences still vary naturally.

    `torch.manual_seed` covers CPU (and CUDA when present); MPS keeps its own
    generator, so seed it explicitly when the build has one.
    """
    import torch

    value = int(seed) & 0x7FFFFFFF
    torch.manual_seed(value)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(value)
    mps = getattr(torch, "mps", None)
    if mps is not None and hasattr(mps, "manual_seed"):
        try:
            mps.manual_seed(value)
        except Exception:  # noqa: BLE001 - CPU-only builds have no MPS backend
            pass


def stable_fallback_seed(voice):
    """FNV-1a of `qwen3||<voice>` — the same hash Nexus sends (ttsSeed.js).

    Used only when a client omits `seed`, so an old caller still gets a stable
    timbre instead of a fresh roll on every sentence.
    """
    identity = f"qwen3||{str(voice or '').strip()}"
    value = 0x811C9DC5
    for char in identity:
        value ^= ord(char)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return (value & 0x7FFFFFFF) or 1


def synthesize_sentence(text, speaker, language, instruct, seed=None):
    """Generate one sentence. Caller MUST hold `_model_lock`."""
    model = load_model_locked()
    supported_languages = None
    try:
        supported_languages = model.get_supported_languages()
    except Exception:  # noqa: BLE001 - optional capability
        supported_languages = None

    # Seeding INSIDE the lock: two concurrent requests must not interleave
    # their RNG state between the seed call and the generation call.
    seed_everything(seed if seed is not None else stable_fallback_seed(speaker))

    wavs, sample_rate = model.generate_custom_voice(
        text=text,
        language=resolve_language(language, supported_languages),
        speaker=speaker,
        instruct=instruct or "",
    )
    if not wavs:
        return b"", sample_rate or SAMPLE_RATE
    return encode_pcm16(wavs[0]), int(sample_rate or SAMPLE_RATE)


class Qwen3TtsHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"NexusQwen3TTS/{SIDECAR_VERSION}"

    def log_message(self, message, *args):
        logger.debug("%s - %s", self.address_string(), message % args)

    def _authorize(self):
        failure = authorize_request(
            token=_SIDECAR_TOKEN,
            method=self.command,
            headers=self.headers,
            content_types=("application/json",),
            max_body_bytes=MAX_JSON_BODY_BYTES,
        )
        if failure:
            status, message = failure
            # The rejected body was never read; do not reuse this connection.
            self.close_connection = True
            self._send_json(status, {"error": {"message": message}})
            return False
        return True

    def do_OPTIONS(self):
        if not self._authorize():
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_chunk(self, data):
        if not data:
            return
        self.wfile.write(f"{len(data):X}\r\n".encode("ascii"))
        self.wfile.write(data)
        self.wfile.write(b"\r\n")

    def _finish_chunks(self):
        self.wfile.write(b"0\r\n\r\n")

    def do_GET(self):
        if not self._authorize():
            return
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "service": "qwen3-tts",
                    "loaded": _model is not None,
                    "device": _model_device,
                    "model": _model_dir,
                    "speakers": get_speakers_locked(),
                    "error": _model_error,
                },
            )
            return
        if path == "/v1/speakers":
            self._send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {"id": speaker, "object": "speaker"}
                        for speaker in get_speakers_locked()
                    ],
                },
            )
            return
        if path == "/v1/models":
            self._send_json(
                200,
                {"object": "list", "data": [{"id": "qwen3-tts-local", "object": "model"}]},
            )
            return
        self._send_json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if not self._authorize():
            return
        path = self.path.split("?", 1)[0]
        if path == "/v1/warmup":
            self._handle_warmup()
            return
        if path == "/v1/audio/speech":
            self._handle_speech()
            return
        self._send_json(404, {"error": {"message": "not found"}})

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_JSON_BODY_BYTES:
            raise ValueError("payload too large")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8", errors="replace") or "{}")

    def _handle_warmup(self):
        try:
            # The guard requires a bounded Content-Length on POST; consume the
            # (ignored) body so an HTTP/1.1 connection stays in sync.
            self._read_json_body()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": {"message": "invalid JSON body"}})
            return
        started = time.monotonic()
        try:
            with _model_lock:
                load_model_locked()
                speakers = get_speakers_locked()
        except Exception as error:  # noqa: BLE001 - surfaced as JSON
            self._send_json(
                503,
                {"status": "error", "loaded": False, "error": f"{type(error).__name__}: {error}"},
            )
            return
        self._send_json(
            200,
            {
                "status": "ok",
                "loaded": True,
                "device": _model_device,
                "speakers": speakers,
                "elapsedMs": round((time.monotonic() - started) * 1000),
            },
        )

    def _handle_speech(self):
        try:
            body = self._read_json_body()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": {"message": "invalid JSON body"}})
            return

        text = str(body.get("input", "") or "").strip()
        if not text:
            self._send_json(400, {"error": {"message": "missing input text"}})
            return

        speaker = str(body.get("voice", "") or "").strip().lower() or "vivian"
        instructions = str(body.get("instructions", "") or "").strip()
        language = str(body.get("language", "") or "").strip()
        seed_raw = body.get("seed")
        seed = None
        if seed_raw is not None:
            try:
                seed = int(seed_raw) & 0x7FFFFFFF
            except (TypeError, ValueError):
                seed = None
        if seed is None:
            seed = stable_fallback_seed(speaker)
        sentences = split_sentences(text)
        if not sentences:
            self._send_json(400, {"error": {"message": "missing input text"}})
            return

        # Load before the first byte so a missing/broken checkpoint can still
        # answer with a real HTTP error instead of a truncated 200 stream.
        try:
            with _model_lock:
                load_model_locked()
                speakers = {name.lower() for name in get_speakers_locked()}
        except Exception as error:  # noqa: BLE001 - surfaced as JSON
            self._send_json(
                503,
                {"status": "error", "loaded": False, "error": f"{type(error).__name__}: {error}"},
            )
            return

        if speaker not in speakers and speakers:
            self._send_json(
                400,
                {
                    "error": {
                        "message": f"unsupported speaker: {speaker}",
                        "supported": sorted(speakers),
                    }
                },
            )
            return

        logger.info(
            "speech: speaker=%s language=%s sentences=%d chars=%d instruct=%s seed=%s",
            speaker,
            language or "auto",
            len(sentences),
            len(text),
            instructions[:60],
            seed,
        )

        self.send_response(200)
        self.send_header("Content-Type", "audio/pcm")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Sample-Rate", str(SAMPLE_RATE))
        self.end_headers()

        started = time.monotonic()
        try:
            for index, sentence in enumerate(sentences):
                with _model_lock:
                    pcm, sample_rate = synthesize_sentence(
                        sentence,
                        speaker=speaker,
                        language=language,
                        instruct=instructions,
                        seed=seed,
                    )
                if not pcm:
                    continue
                self._send_chunk(pcm)
                self.wfile.flush()
                logger.info(
                    "sentence %d/%d: %.2fs audio in %.1fs",
                    index + 1,
                    len(sentences),
                    len(pcm) / 2 / max(1, sample_rate),
                    time.monotonic() - started,
                )
            self._finish_chunks()
        except (BrokenPipeError, ConnectionResetError):
            # Barge-in closes the socket mid-sentence. Nothing to report: the
            # renderer already treated the abort as a normal stop.
            logger.info("client disconnected; stopping stream")
        except Exception as error:  # noqa: BLE001 - stream already started
            logger.exception("generation failed")
            try:
                self._finish_chunks()
            except (BrokenPipeError, ConnectionResetError):
                pass


def run_selftest():
    """Load the model, synthesize, and verify the seed makes output repeatable."""
    started = time.monotonic()
    seed = 42
    text = "你好，我是 Nexus 的本地语音。"
    with _model_lock:
        load_model_locked()
        load_seconds = time.monotonic() - started
        synth_started = time.monotonic()
        pcm, sample_rate = synthesize_sentence(
            text,
            speaker="vivian",
            language="Chinese",
            instruct="带点傲娇，语气轻快",
            seed=seed,
        )
        synth_seconds = time.monotonic() - synth_started
        repeat_pcm, _ = synthesize_sentence(
            text,
            speaker="vivian",
            language="Chinese",
            instruct="带点傲娇，语气轻快",
            seed=seed,
        )
        other_pcm, _ = synthesize_sentence(
            text,
            speaker="vivian",
            language="Chinese",
            instruct="带点傲娇，语气轻快",
            seed=seed + 1,
        )

    duration = len(pcm) / 2 / max(1, sample_rate)
    print(f"device={_model_device}")
    print(f"load={load_seconds:.2f}s synth={synth_seconds:.2f}s")
    print(f"audio={duration:.2f}s sample_rate={sample_rate} pcm_bytes={len(pcm)}")
    print(f"realtime_factor={synth_seconds / max(0.001, duration):.2f}x")
    print(
        "seed repeatability: "
        f"same_seed_bytes_equal={pcm == repeat_pcm} "
        f"same_seed_len={len(repeat_pcm)} other_seed_len={len(other_pcm)} "
        f"other_seed_differs={pcm != other_pcm}"
    )
    if pcm != repeat_pcm:
        print("SELFTEST FAILED: the same seed produced different audio")
        raise SystemExit(1)
    print("SELFTEST OK")


def main():
    global _model_dir, _model_revision, _SIDECAR_TOKEN

    parser = argparse.ArgumentParser(description="Qwen3-TTS local speech sidecar")
    parser.add_argument("--port", type=int, default=8002)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument(
        "--model-dir",
        type=str,
        default=os.environ.get("NEXUS_QWEN3_TTS_MODEL_DIR") or str(DEFAULT_MODEL_DIR),
    )
    parser.add_argument(
        "--model-revision",
        type=str,
        default=os.environ.get(QWEN3_TTS_REVISION_ENV) or QWEN3_TTS_DEFAULT_REVISION,
    )
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        format="%(asctime)s %(levelname)s [%(filename)s:%(lineno)d] %(message)s",
        level=logging.INFO,
    )
    _model_dir = str(Path(args.model_dir).expanduser())
    _model_revision = str(args.model_revision or "").strip()

    if args.selftest:
        run_selftest()
        return

    _SIDECAR_TOKEN = require_sidecar_token()

    server = ThreadingHTTPServer((args.host, args.port), Qwen3TtsHandler)
    server.daemon_threads = True
    logger.info(
        "Qwen3-TTS sidecar v%s listening on http://%s:%d (model=%s)",
        SIDECAR_VERSION,
        args.host,
        args.port,
        _model_dir,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("stopping")


if __name__ == "__main__":
    main()
