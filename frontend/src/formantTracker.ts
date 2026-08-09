import { estimateFormants } from "./lpc";

export interface TrackedFormants { f1: number; f2: number; f3: number; voiced: boolean }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export class FormantTracker {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frame = new Float32Array(2048);
  private animation = 0;
  private active = false;
  private histories: number[][] = [[], [], []];
  private smoothed: number[] = [];

  constructor(private readonly onFrame: (value: TrackedFormants | null) => void) {}

  async start(): Promise<void> {
    if (this.stream) return;
    this.active = true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    } });
    if (!this.active) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.stream = stream;
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    this.tick();
  }

  suspend(): void { if (this.animation) cancelAnimationFrame(this.animation); this.animation = 0; this.onFrame(null); }
  resume(): void { if (this.stream && !this.animation) this.tick(); }

  stop(): void {
    this.active = false;
    this.suspend();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }

  private tick = (): void => {
    if (!this.analyser || !this.context) return;
    this.analyser.getFloatTimeDomainData(this.frame);
    let power = 0;
    for (const sample of this.frame) power += sample * sample;
    if (Math.sqrt(power / this.frame.length) < 0.012) {
      this.onFrame(null);
    } else {
      const processed = this.prepare(this.frame, this.context.sampleRate);
      const formants = estimateFormants(processed.samples, processed.sampleRate).slice(0, 3);
      if (formants.length === 3) {
        const values = formants.map((f) => f.frequency);
        values.forEach((value, i) => {
          this.histories[i].push(value);
          if (this.histories[i].length > 5) this.histories[i].shift();
          const middle = median(this.histories[i]);
          this.smoothed[i] = this.smoothed[i] == null ? middle : this.smoothed[i] * 0.75 + middle * 0.25;
        });
        this.onFrame({ f1: this.smoothed[0], f2: this.smoothed[1], f3: this.smoothed[2], voiced: true });
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  };

  private prepare(input: Float32Array, inputRate: number): { samples: Float32Array; sampleRate: number } {
    const factor = Math.max(1, Math.round(inputRate / 10000));
    const rate = inputRate / factor;
    const output = new Float32Array(Math.floor(1024 / factor));
    let previous = 0;
    for (let i = 0; i < output.length; i++) {
      const center = input.length - 1024 + i * factor;
      let sum = 0;
      let count = 0;
      for (let j = -factor; j <= factor; j++) if (center + j >= 0 && center + j < input.length) { sum += input[center + j]; count++; }
      const sample = sum / count;
      const emphasized = sample - 0.97 * previous;
      previous = sample;
      output[i] = emphasized * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (output.length - 1)));
    }
    return { samples: output, sampleRate: rate };
  }
}
