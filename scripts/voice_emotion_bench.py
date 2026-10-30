"""Developer-only prosody bench for the per-sentence voice instructions.

Reads a JSON spec from stdin:

    {"seeds": [42, 1337, 2024], "speaker": "vivian", "model_dir": "...",
     "samples": [{"id": "neutral", "language": "Chinese", "text": "...",
                  "instruction": ""}, ...]}

and prints one JSON line per sample with mean F0, F0 range, RMS dB and audio
length, averaged over the seed set (one take can be lucky; the direction has to
survive a re-roll). The text never leaves this process and no audio is written
to disk — everything is measured in memory and discarded.

The caller (`scripts/voice-emotion-bench.mjs`) is the source of truth for the
instructions: it derives them from `src/features/voice/voiceEmotion.ts`, so this
file only knows how to synthesize and measure.
"""

import json
import os
import sys

DEFAULT_MODEL_DIR = "~/Models/qwen3-tts/Qwen3-TTS-12Hz-1.7B-CustomVoice"


def load_model(model_dir):
    import torch
    from qwen_tts import Qwen3TTSModel

    return Qwen3TTSModel.from_pretrained(model_dir, device_map="mps", dtype=torch.float16)


def seed_everything(seed):
    """Mirror the sidecar: CPU and MPS generators are both pinned per call."""
    import torch

    torch.manual_seed(int(seed))
    mps = getattr(torch, "mps", None)
    if mps is not None and hasattr(mps, "manual_seed"):
        try:
            mps.manual_seed(int(seed))
        except Exception:  # noqa: BLE001 - CPU-only torch builds have no MPS
            pass


def features(waveform, sample_rate):
    import librosa
    import numpy as np

    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    f0, _voiced, _prob = librosa.pyin(samples, fmin=80, fmax=600, sr=sample_rate)
    f0 = f0[~np.isnan(f0)]
    rms = librosa.feature.rms(y=samples)[0]
    return {
        "f0_mean": round(float(np.mean(f0)), 1) if f0.size else None,
        "f0_range": round(float(np.percentile(f0, 95) - np.percentile(f0, 5)), 1)
        if f0.size
        else None,
        "rms_db": round(float(20 * np.log10(np.mean(rms) + 1e-9)), 1),
        "duration": round(len(samples) / sample_rate, 2),
    }


def average_runs(runs, key):
    """Mean of one metric across seeds, skipping seeds where it is undefined."""
    values = [run[key] for run in runs if run[key] is not None]
    return round(sum(values) / len(values), 2) if values else None


def main():
    spec = json.load(sys.stdin)
    import torch

    model_dir = os.path.expanduser(str(spec.get("model_dir") or DEFAULT_MODEL_DIR))
    speaker = str(spec.get("speaker") or "vivian")
    seeds = [int(seed) for seed in (spec.get("seeds") or [spec.get("seed") or 42])]
    samples = spec.get("samples") or []
    if not samples:
        print(json.dumps({"error": "no samples"}))
        return 1

    model = load_model(model_dir)
    print(json.dumps({"event": "model_loaded", "torch": torch.__version__, "seeds": seeds}), flush=True)

    # One throwaway generation so the first measured sample does not pay for
    # lazy graph compilation.
    seed_everything(seeds[0])
    model.generate_custom_voice(text="预热一下。", language="Chinese", speaker=speaker, instruct="")

    for sample in samples:
        runs = []
        for seed in seeds:
            seed_everything(seed)
            wave, sample_rate = model.generate_custom_voice(
                text=sample["text"],
                language=sample.get("language") or "Chinese",
                speaker=speaker,
                instruct=sample.get("instruction") or "",
            )
            runs.append(features(wave[0], sample_rate))
        # One instruction can land on a lucky or unlucky take; averaging over
        # the same fixed seed set keeps the comparison paired and stable.
        measured = {
            key: average_runs(runs, key)
            for key in ("f0_mean", "f0_range", "rms_db", "duration")
        }
        result = {
            "id": sample["id"],
            "instruction": sample.get("instruction") or "",
            "runs": len(runs),
            **measured,
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
