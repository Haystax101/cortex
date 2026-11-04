import { api } from "./api";

// Speaks streamed assistant text sentence by sentence: text deltas are fed in,
// complete sentences are synthesised on the server (Kokoro) and played in order.
// Falls back to the browser's speechSynthesis if the server has no TTS.

class Speaker {
  private pending = "";
  private queue: Promise<void> = Promise.resolve();
  private audio: HTMLAudioElement | null = null;
  private enabled = false;
  private serverTts: boolean | null = null;
  private generation = 0;
  private listeners = new Set<(speaking: boolean) => void>();
  private speakingCount = 0;
  // True until the first chunk of an utterance is queued. The first chunk is cut
  // at the first clause boundary so audio starts while the model is still writing.
  private fresh = true;

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.stop();
  }
  isEnabled() {
    return this.enabled;
  }
  onSpeaking(fn: (s: boolean) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    const s = this.speakingCount > 0;
    for (const l of this.listeners) l(s);
  }

  // iOS requires audio playback to be unlocked from a user gesture.
  unlock() {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.play().catch(() => {});
    }
  }

  isSpeaking() {
    return this.speakingCount > 0;
  }

  feed(delta: string) {
    if (!this.enabled) return;
    this.pending += delta;
    if (this.fresh) {
      const clause = /^[\s\S]{12,}?(?:[.!?]+["')\]]?|[,;:\u2014\u2013])\s/.exec(this.pending);
      if (clause) {
        this.enqueue(clause[0]);
        this.pending = this.pending.slice(clause[0].length);
        this.fresh = false;
      } else {
        return;
      }
    }
    // Flush complete sentences; keep the tail.
    const re = /([^.!?\n]+[.!?]+["')\]]?\s+|[^\n]+\n+)/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = re.exec(this.pending))) {
      this.enqueue(m[0]);
      consumed = re.lastIndex;
    }
    if (consumed) this.pending = this.pending.slice(consumed);
    // A very long run-on sentence: speak what we have at a word boundary.
    if (this.pending.length > 180) {
      const cut = this.pending.lastIndexOf(" ", 160);
      if (cut > 40) {
        this.enqueue(this.pending.slice(0, cut));
        this.pending = this.pending.slice(cut + 1);
      }
    }
  }

  flush() {
    this.fresh = true;
    if (!this.enabled) {
      this.pending = "";
      return;
    }
    const t = this.pending.trim();
    this.pending = "";
    if (t) this.enqueue(t);
  }

  stop() {
    this.generation++;
    this.fresh = true;
    this.pending = "";
    this.queue = Promise.resolve();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.speakingCount = 0;
    this.emit();
  }

  private clean(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, " code block omitted. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#+\s*/gm, "")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "a link")
      .replace(/\s+/g, " ")
      .trim();
  }

  private enqueue(raw: string) {
    const text = this.clean(raw);
    if (!text || text.length < 2) return;
    const gen = this.generation;
    // Start synthesis immediately (overlaps with the previous clip playing).
    const clip = this.serverTts === false ? null : api.tts(text).then((b) => URL.createObjectURL(b)).catch(() => null);
    this.speakingCount++;
    this.emit();
    this.queue = this.queue
      .then(async () => {
        if (gen !== this.generation) return;
        const url = clip ? await clip : null;
        if (gen !== this.generation) return;
        if (url) {
          this.serverTts = true;
          await this.playUrl(url, gen);
          URL.revokeObjectURL(url);
        } else {
          this.serverTts = false;
          await this.speakBrowser(text, gen);
        }
      })
      .catch(() => {})
      .finally(() => {
        this.speakingCount = Math.max(0, this.speakingCount - 1);
        this.emit();
      });
  }

  private playUrl(url: string, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.audio) this.audio = new Audio();
      const a = this.audio;
      const done = () => {
        a.onended = null;
        a.onerror = null;
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.src = url;
      if (gen !== this.generation) return done();
      a.play().catch(done);
    });
  }

  private speakBrowser(text: string, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || gen !== this.generation) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}

export const speaker = new Speaker();

// Push-to-talk recorder around MediaRecorder.
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        this.stream?.getTracks().forEach((t) => t.stop());
        this.rec = null;
        this.stream = null;
        resolve(blob.size > 2000 ? blob : null);
      };
      rec.stop();
    });
  }

  isRecording() {
    return !!this.rec && this.rec.state === "recording";
  }
}
