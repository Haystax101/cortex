#!/usr/bin/env python
"""Kokoro text-to-speech daemon for Cortex.

Reads one JSON object per line on stdin: {"id": "...", "text": "...", "voice": "bm_lewis", "speed": 1.05, "out": "/path.wav"}
Writes one JSON line per request on stdout: {"id": "...", "ok": true, "path": "...", "seconds": 1.2}
Keeping the model loaded avoids ~0.8s startup per sentence.
"""
import json
import os
import sys
import time

import soundfile as sf
from kokoro_onnx import Kokoro

VOICE_DIR = os.environ.get("CORTEX_VOICE_DIR", os.path.expanduser("~/cortex-voice"))
MODEL = os.path.join(VOICE_DIR, "models", "kokoro-v1.0.onnx")
VOICES = os.path.join(VOICE_DIR, "models", "voices-v1.0.bin")


def main() -> None:
    kokoro = Kokoro(MODEL, VOICES)
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            text = (req.get("text") or "").strip()
            voice = req.get("voice") or "bm_lewis"
            speed = float(req.get("speed") or 1.05)
            out = req["out"]
            t0 = time.time()
            if not text:
                raise ValueError("empty text")
            samples, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-gb")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            sf.write(out, samples, sr)
            sys.stdout.write(
                json.dumps({"id": req.get("id"), "ok": True, "path": out, "seconds": round(len(samples) / sr, 2), "gen": round(time.time() - t0, 2)}) + "\n"
            )
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(json.dumps({"id": (req.get("id") if isinstance(req, dict) else None), "ok": False, "error": str(e)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
