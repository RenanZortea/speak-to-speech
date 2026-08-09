export interface Complex { re: number; im: number }
export interface Formant { frequency: number; bandwidth: number }

export function bark(frequency: number): number {
  return 26.81 * frequency / (1960 + frequency) - 0.53;
}

export function autocorrelation(samples: ArrayLike<number>, order: number): number[] {
  const out = new Array<number>(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag++)
    for (let i = lag; i < samples.length; i++) out[lag] += samples[i] * samples[i - lag];
  return out;
}

export function levinsonDurbin(r: number[], order = r.length - 1): number[] {
  const a = new Array<number>(order + 1).fill(0);
  a[0] = 1;
  let error = r[0];
  if (!Number.isFinite(error) || error <= 1e-12) return a;
  for (let i = 1; i <= order; i++) {
    let sum = r[i] ?? 0;
    for (let j = 1; j < i; j++) sum += a[j] * r[i - j];
    const reflection = Math.max(-0.999, Math.min(0.999, -sum / error));
    const previous = a.slice();
    a[i] = reflection;
    for (let j = 1; j < i; j++) a[j] = previous[j] + reflection * previous[i - j];
    error *= 1 - reflection * reflection;
    if (error <= 1e-12) break;
  }
  return a;
}

function mul(a: Complex, b: Complex): Complex { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function sub(a: Complex, b: Complex): Complex { return { re: a.re - b.re, im: a.im - b.im }; }
function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im || 1e-20;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function evaluate(coefficients: number[], z: Complex): Complex {
  let value = { re: coefficients[0], im: 0 };
  for (let i = 1; i < coefficients.length; i++) value = { ...mul(value, z), re: mul(value, z).re + coefficients[i] };
  return value;
}

export function durandKerner(coefficients: number[], iterations = 100): Complex[] {
  const n = coefficients.length - 1;
  if (n < 1 || coefficients[0] === 0) return [];
  const c = coefficients.map((v) => v / coefficients[0]);
  let roots = Array.from({ length: n }, (_, k) => {
    const angle = 2 * Math.PI * k / n + 0.17;
    return { re: Math.cos(angle), im: Math.sin(angle) };
  });
  for (let pass = 0; pass < iterations; pass++) {
    let maxDelta = 0;
    roots = roots.map((root, i) => {
      let denominator = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) if (j !== i) denominator = mul(denominator, sub(root, roots[j]));
      const delta = div(evaluate(c, root), denominator);
      maxDelta = Math.max(maxDelta, Math.hypot(delta.re, delta.im));
      return sub(root, delta);
    });
    if (maxDelta < 1e-10) break;
  }
  return roots;
}

export function rootsToFormants(roots: Complex[], sampleRate: number): Formant[] {
  return roots
    .filter((root) => root.im > 0)
    .map((root) => ({
      frequency: Math.atan2(root.im, root.re) * sampleRate / (2 * Math.PI),
      bandwidth: -Math.log(Math.hypot(root.re, root.im)) * sampleRate / Math.PI,
    }))
    .filter((f) => f.frequency > 90 && f.frequency < 5000 && f.bandwidth > 0 && f.bandwidth < 400)
    .sort((a, b) => a.frequency - b.frequency);
}

export function estimateFormants(samples: Float32Array, sampleRate: number, order = 12): Formant[] {
  return rootsToFormants(durandKerner(levinsonDurbin(autocorrelation(samples, order), order)), sampleRate);
}
