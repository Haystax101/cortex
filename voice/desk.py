#!/usr/bin/env python
"""Cortex desk voice client.

Hold RIGHT OPTION anywhere in macOS to talk; release to send. The reply is spoken
sentence by sentence through the server's Kokoro TTS. Optional wake word
("hey jarvis" pretrained model; a custom "cortex" model can be dropped in) with --wake.

Runs against the Cortex server (default http://127.0.0.1:3001). Keeps one chat per
workspace and follows switch_workspace calls made by the model.

Must be launched from a Terminal window (not launchd) so macOS grants microphone
and Input Monitoring permissions to Terminal.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import wave

import numpy as np
import requests
import sounddevice as sd
import soundfile as sf
from pynput import keyboard

SERVER = os.environ.get("CORTEX_URL", "http://127.0.0.1:3001")
STATE_FILE = os.path.expanduser("~/.cortex/desk-state.json")
SAMPLE_RATE = 16000
YES = re.compile(r"^(yes|yeah|yep|allow|go ahead|do it|approved?|confirm|sure)\b", re.I)
NO = re.compile(r"^(no|nope|deny|don't|do not|stop|cancel)\b", re.I)
SENTENCE = re.compile(r"([^.!?\n]+[.!?]+[\"')\]]?\s+|[^\n]+\n+)")


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ----------------------------------------------------------------- state

def load_state() -> dict:
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {"workspace": "brain", "chats": {}}


def save_state(st: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    json.dump(st, open(STATE_FILE, "w"), indent=2)


# ----------------------------------------------------------------- audio out

class Mouth:
    """Plays TTS clips in order; synthesis of the next sentence overlaps playback."""

    def __init__(self) -> None:
        self.q: queue.Queue[str | None] = queue.Queue()
        self.gen = 0
        self.speaking = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def say(self, text: str) -> None:
        text = clean(text)
        if len(text) < 2:
            return
        self.q.put(text)

    def stop(self) -> None:
        self.gen += 1
        with self.q.mutex:
            self.q.queue.clear()
        sd.stop()

    def _fetch(self, text: str) -> np.ndarray | None:
        try:
            r = requests.post(f"{SERVER}/api/voice/tts", json={"text": text}, timeout=60)
            if r.status_code != 200:
                return None
            data, sr = sf.read(io.BytesIO(r.content), dtype="float32")
            return (data, sr)  # type: ignore[return-value]
        except Exception as e:  # noqa: BLE001
            log(f"tts error: {e}")
            return None

    def _loop(self) -> None:
        pending = None
        while True:
            text = self.q.get()
            gen = self.gen
            clip = self._fetch(text)
            if clip is None or gen != self.gen:
                continue
            data, sr = clip
            self.speaking.set()
            sd.play(data, sr)
            sd.wait()
            self.speaking.clear()
            del pending


def clean(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " code block omitted. ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*]\s+", "", text, flags=re.M)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "a link", text)
    return re.sub(r"\s+", " ", text).strip()


# ----------------------------------------------------------------- audio in

class Ear:
    def __init__(self) -> None:
        self.frames: list[np.ndarray] = []
        self.stream: sd.InputStream | None = None

    def start(self) -> None:
        self.frames = []
        self.stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=self._cb)
        self.stream.start()

    def _cb(self, indata, frames, t, status) -> None:  # noqa: ANN001
        self.frames.append(indata.copy())

    def stop(self) -> bytes | None:
        if not self.stream:
            return None
        self.stream.stop()
        self.stream.close()
        self.stream = None
        if not self.frames:
            return None
        audio = np.concatenate(self.frames)
        if len(audio) < SAMPLE_RATE * 0.4:
            return None
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(audio.tobytes())
        return buf.getvalue()


def transcribe(wav: bytes) -> str:
    r = requests.post(f"{SERVER}/api/voice/stt", files={"audio": ("clip.wav", wav, "audio/wav")}, timeout=120)
    r.raise_for_status()
    return r.json().get("text", "").strip()


# ----------------------------------------------------------------- chat

class Chat:
    def __init__(self, mouth: Mouth) -> None:
        self.mouth = mouth
        self.state = load_state()
        self.pending_ask: dict | None = None
        self.pending_switch: str | None = None
        self.ws = None

    def _connect(self):
        import websocket  # websocket-client

        url = SERVER.replace("http", "ws", 1) + "/ws"
        return websocket.create_connection(url, timeout=600)

    def send(self, text: str) -> None:
        # Voice answers to a pending permission prompt.
        if self.pending_ask:
            if YES.match(text):
                self._reply_ask(True)
                return
            if NO.match(text):
                self._reply_ask(False)
                return
        ws_id = self.state.get("workspace", "brain")
        chat_id = self.state.get("chats", {}).get(ws_id)
        log(f"[{ws_id}] you: {text}")
        try:
            ws = self._connect()
        except Exception as e:  # noqa: BLE001
            log(f"cannot reach server: {e}")
            self.mouth.say("I can't reach the Cortex server.")
            return
        ws.send(json.dumps({"type": "chat.send", "chatId": chat_id, "text": text, "workspace": ws_id, "voice": True}))
        buf = ""
        spoken = ""
        try:
            while True:
                raw = ws.recv()
                f = json.loads(raw)
                t = f.get("type")
                if t == "chat.session":
                    self.state.setdefault("chats", {})[ws_id] = f["chatId"]
                    save_state(self.state)
                elif t == "text.delta":
                    buf += f["text"]
                    spoken += f["text"]
                    while True:
                        m = SENTENCE.match(buf)
                        if not m:
                            break
                        self.mouth.say(m.group(0))
                        buf = buf[m.end():]
                elif t == "tool.start":
                    if buf.strip():
                        self.mouth.say(buf)
                        buf = ""
                elif t == "permission.ask":
                    self.pending_ask = f
                    desc = (f.get("input") or {}).get("description") or f.get("label")
                    self.mouth.say(f"Permission needed: {desc}. Say yes or no.")
                elif t == "workspace.switch":
                    self.pending_switch = f["workspace"]
                elif t == "turn.done":
                    if buf.strip():
                        self.mouth.say(buf)
                    log(f"[{ws_id}] cortex: {clean(spoken)[:300]}")
                    break
                elif t == "chat.error":
                    log(f"error: {f.get('error')}")
                    self.mouth.say("Something went wrong on the server.")
                    break
        finally:
            ws.close()
        if self.pending_switch:
            self.state["workspace"] = self.pending_switch
            self.state.setdefault("chats", {}).pop(self.pending_switch, None)  # fresh chat in the new workspace
            save_state(self.state)
            log(f"switched workspace → {self.pending_switch}")
            self.pending_switch = None

    def _reply_ask(self, allow: bool) -> None:
        ask = self.pending_ask
        self.pending_ask = None
        if not ask:
            return
        try:
            ws = self._connect()
            ws.send(json.dumps({"type": "permission.reply", "id": ask["id"], "allow": allow}))
            ws.close()
            self.mouth.say("Allowed." if allow else "Denied.")
        except Exception as e:  # noqa: BLE001
            log(f"permission reply failed: {e}")


# ----------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wake", action="store_true", help="also listen for the wake word (hey jarvis / cortex model if present)")
    ap.add_argument("--workspace", help="start in this workspace")
    args = ap.parse_args()

    mouth = Mouth()
    ear = Ear()
    chat = Chat(mouth)
    if args.workspace:
        chat.state["workspace"] = args.workspace
        save_state(chat.state)

    try:
        requests.get(f"{SERVER}/api/health", timeout=5).raise_for_status()
    except Exception:
        log(f"Cortex server not reachable at {SERVER}. Start it first (run-cortex.sh).")
        sys.exit(1)

    busy = threading.Lock()
    holding = {"v": False}

    def finish() -> None:
        wav = ear.stop()
        if not wav:
            log("(too short)")
            return
        try:
            text = transcribe(wav)
        except Exception as e:  # noqa: BLE001
            log(f"stt failed: {e}")
            return
        if not text:
            log("(heard nothing)")
            return
        chat.send(text)

    def on_press(key) -> None:  # noqa: ANN001
        if key == keyboard.Key.alt_r and not holding["v"]:
            holding["v"] = True
            mouth.stop()
            ear.start()
            log("● listening")

    def on_release(key) -> None:  # noqa: ANN001
        if key == keyboard.Key.alt_r and holding["v"]:
            holding["v"] = False
            log("○ processing")
            if busy.acquire(blocking=False):
                try:
                    finish()
                finally:
                    busy.release()

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()
    log(f"Cortex desk client ready. Hold RIGHT OPTION to talk. Workspace: {chat.state.get('workspace', 'brain')}")

    if args.wake:
        threading.Thread(target=wake_loop, args=(mouth, ear, chat, busy, holding), daemon=True).start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


def wake_loop(mouth: Mouth, ear: Ear, chat: Chat, busy: threading.Lock, holding: dict) -> None:
    """Wake word → record until ~1.2s of silence → send. Uses openWakeWord."""
    try:
        import openwakeword
        from openwakeword.model import Model
    except Exception as e:  # noqa: BLE001
        log(f"wake word unavailable: {e}")
        return
    custom = os.path.expanduser("~/cortex-voice/models/cortex.onnx")
    if os.path.exists(custom):
        model = Model(wakeword_models=[custom], inference_framework="onnx")
        name = "cortex"
    else:
        openwakeword.utils.download_models(model_names=["hey_jarvis"])
        model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        name = "hey jarvis"
    log(f"wake word active: say '{name}'")
    chunk = 1280
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=chunk) as stream:
        while True:
            data, _ = stream.read(chunk)
            if holding["v"] or mouth.speaking.is_set():
                model.reset()
                continue
            scores = model.predict(np.frombuffer(data.tobytes(), dtype=np.int16))
            if max(scores.values()) > 0.5:
                model.reset()
                if not busy.acquire(blocking=False):
                    continue
                try:
                    log("● wake word")
                    mouth.stop()
                    rec: list[np.ndarray] = []
                    silent = 0.0
                    started = time.time()
                    while True:
                        d, _ = stream.read(chunk)
                        rec.append(np.frombuffer(d.tobytes(), dtype=np.int16))
                        level = float(np.abs(rec[-1]).mean())
                        silent = silent + chunk / SAMPLE_RATE if level < 300 else 0.0
                        if (silent > 1.2 and time.time() - started > 1.5) or time.time() - started > 20:
                            break
                    audio = np.concatenate(rec)
                    buf = io.BytesIO()
                    with wave.open(buf, "wb") as w:
                        w.setnchannels(1)
                        w.setsampwidth(2)
                        w.setframerate(SAMPLE_RATE)
                        w.writeframes(audio.tobytes())
                    text = transcribe(buf.getvalue())
                    if text:
                        chat.send(text)
                finally:
                    busy.release()


if __name__ == "__main__":
    main()
