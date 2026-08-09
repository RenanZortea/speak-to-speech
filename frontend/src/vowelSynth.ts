export interface SynthFormants { f1: number; f2: number; f3: number }

export class VowelSynth {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private makeup: GainNode | null = null;
  private master: GainNode | null = null;
  private formants: SynthFormants = { f1: 500, f2: 1500, f3: 2500 };
  private pitch = 120;
  private volume = 0.25;

  async start(): Promise<void> {
    if (this.oscillator) return;
    const context = this.context ?? new AudioContext();
    this.context = context;
    await context.resume();
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = this.pitch;
    const values = [this.formants.f1, this.formants.f2, this.formants.f3];
    const bandwidths = [70, 100, 150];
    this.filters = values.map((frequency, i) => {
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = frequency / bandwidths[i];
      return filter;
    });
    this.makeup = context.createGain();
    this.makeup.gain.value = 12;
    this.master = context.createGain();
    this.master.gain.setValueAtTime(0, context.currentTime);
    oscillator.connect(this.filters[0]);
    this.filters[0].connect(this.filters[1]);
    this.filters[1].connect(this.filters[2]);
    this.filters[2].connect(this.makeup).connect(this.master).connect(context.destination);
    oscillator.start();
    this.master.gain.setTargetAtTime(this.volume, context.currentTime, 0.007);
    this.oscillator = oscillator;
  }

  stop(): void {
    if (!this.context || !this.oscillator || !this.master) return;
    const oscillator = this.oscillator;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.007);
    oscillator.stop(this.context.currentTime + 0.05);
    this.oscillator = null;
    this.filters = [];
    this.master = null;
    this.makeup = null;
  }

  setFormants(formants: SynthFormants): void {
    this.formants = formants;
    if (!this.context) return;
    [formants.f1, formants.f2, formants.f3].forEach((f, i) => {
      this.filters[i]?.frequency.setTargetAtTime(f, this.context!.currentTime, 0.02);
      this.filters[i]?.Q.setTargetAtTime(f / [70, 100, 150][i], this.context!.currentTime, 0.02);
    });
  }

  setPitch(pitch: number): void {
    this.pitch = pitch;
    this.oscillator?.frequency.setTargetAtTime(pitch, this.context!.currentTime, 0.02);
  }

  setGain(volume: number): void {
    this.volume = volume;
    this.master?.gain.setTargetAtTime(volume, this.context!.currentTime, 0.02);
  }

  dispose(): void { this.stop(); void this.context?.close(); this.context = null; }
}
