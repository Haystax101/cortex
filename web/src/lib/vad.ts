// Hands-free listening: an energy-based voice detector over the mic.
// Captures raw PCM with a short pre-roll (so the first word isn't clipped),
// ends an utterance after a pause, and hands back a 16 kHz mono WAV, which
// the server's whisper takes directly with no ffmpeg step.
//
// Barge-in: onSpeechStart fires the moment George starts talking, so the
// caller can stop Cortex mid-sentence. While Cortex is speaking the threshold
// is raised so its own voice (after echo cancellation) doesn't trigger it.

type Opts = {
  onSpeechStart: () => void;
  onUtterance: (wav: Blob) => void;
  onLevel?: (level: number, speaking: boolean) => void;
  isPlaybackActive: () => boolean;
};

const PRE_ROLL_MS = 350;
const START_MS = 120; // sustained energy needed to count as speech
const END_SILENCE_MS = 800; // pause that ends an utterance
const MIN_UTTERANCE_MS = 450;
const MAX_UTTERANCE_MS = 60_000;

export class HandsFree {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private floor = 0.004;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private chunks: Float32Array[] = [];
  private inSpeech = false;
  private aboveMs = 0;
  private silentMs = 0;
  private speechMs = 0;
  private paused = false;

  constructor(private opts: Opts) {}

  get running() {
    return !!this.ctx;
  }

  // Must be called from a user gesture on iOS.
  async start() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => this.process(e.inputBuffer.getChannelData(0));
    this.src.connect(this.node);
    // ScriptProcessor only runs while connected to the destination; it outputs silence.
    this.node.connect(this.ctx.destination);
  }

  stop() {
    this.node?.disconnect();
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.src = null;
    this.stream = null;
    this.reset();
  }

  /** Ignore the mic (e.g. while a push-to-talk recording is in progress). */
  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.reset();
  }

  private reset() {
    this.chunks = [];
    this.inSpeech = false;
    this.aboveMs = 0;
    this.silentMs = 0;
    this.speechMs = 0;
  }

  private process(input: Float32Array) {
    if (!this.ctx || this.paused) return;
    const frame = new Float32Array(input); // the buffer is reused by the browser
    const ms = (frame.length / this.ctx.sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);

    // Track the noise floor slowly upward, quickly downward.
    if (!this.inSpeech) this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.995 + rms * 0.005;
    const playback = this.opts.isPlaybackActive();
    const threshold = Math.max(0.012, this.floor * 3) * (playback ? 2.4 : 1);
    const loud = rms > threshold;
    this.opts.onLevel?.(Math.min(1, rms / (threshold * 2)), this.inSpeech);

    if (!this.inSpeech) {
      this.preRoll.push(frame);
      this.preRollSamples += frame.length;
      const maxPre = (PRE_ROLL_MS / 1000) * this.ctx.sampleRate;
      while (this.preRollSamples - (this.preRoll[0]?.length ?? 0) > maxPre) this.preRollSamples -= this.preRoll.shift()!.length;
      this.aboveMs = loud ? this.aboveMs + ms : 0;
      if (this.aboveMs >= START_MS) {
        this.inSpeech = true;
        this.chunks = [...this.preRoll];
        this.speechMs = this.aboveMs;
        this.silentMs = 0;
        this.preRoll = [];
        this.preRollSamples = 0;
        this.opts.onSpeechStart();
      }
      return;
    }

    this.chunks.push(frame);
    this.speechMs += ms;
    this.silentMs = loud ? 0 : this.silentMs + ms;
    if (this.silentMs >= END_SILENCE_MS || this.speechMs >= MAX_UTTERANCE_MS) {
      const voiced = this.speechMs - this.silentMs;
      const chunks = this.chunks;
      const rate = this.ctx.sampleRate;
      this.reset();
      if (voiced >= MIN_UTTERANCE_MS) this.opts.onUtterance(encodeWav(chunks, rate));
    }
  }
}

// Downsample to 16 kHz mono 16-bit PCM WAV.
function encodeWav(chunks: Float32Array[], inRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    joined.set(c, o);
    o += c.length;
  }
  const outRate = 16000;
  const ratio = inRate / outRate;
  const n = Math.floor(total / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // average the source samples that fall in this output sample (cheap low-pass)
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let acc = 0;
    for (let j = start; j < end; j++) acc += joined[j];
    const v = acc / Math.max(1, end - start);
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (off: number, s: string) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true);
  v.setUint32(28, outRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}
