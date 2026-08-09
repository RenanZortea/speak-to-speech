# Vowel Synthesizer + live formant tuner — design

**Date:** 2026-08-09
**Status:** Approved, pending implementation plan

## Goal

Add a **Vowels** surface to SpeakToSpeech: an interactive F1×F2 vowel pad that

1. **synthesizes** a vowel from formant frequencies (drag the pad, hear the vowel), and
2. **tracks your own voice live** from the microphone, placing a dot on the same
   chart — a tuner for vowels,

with **reference overlays** for General American English and Modern Israeli
Hebrew showing where each language's vowels actually sit.

This replaces, in spirit, the pronunciation-analysis feature removed earlier the
same day — but inverts the approach. That feature ran an ML model over recorded
audio and *judged* it after the fact. This one is an instrument: immediate
feedback, no model, no download, and a target you can hear before you try to hit
it.

## Scope

**In scope.** A self-contained tab. Synthesis, live mic tracking, two language
overlays, explore mode, practice (match-the-target) mode.

**Out of scope, deliberately.** No connection to transcripts, sessions, or saved
recordings. No formant extraction from stored audio. No per-vowel drift tracking
over time. No persistence of any kind — no saved calibration, no saved attempts.
The data model should not *preclude* "plot the vowel from this word in my
transcript" later, but nothing is built for it now.

## Reference data

Both datasets were extracted from source, not recalled: the R `phonTools`
package's `.rda` archives were downloaded and parsed directly (minimal R
serialization reader), and the group means computed from the raw observations.

### General American English

Hillenbrand, Getty, Clark & Wheeler (1995), "Acoustic characteristics of American
English vowels," *JASA* 97(5):3099–3111. 12 monophthongs in an /hVd/ frame.
**n = 45 men, 48 women.** Values are group means of the steady-state measurement,
in Hz.

| IPA | Wells set | keyword | ♂ F1 | ♂ F2 | ♂ F3 | ♀ F1 | ♀ F2 | ♀ F3 |
|-----|-----------|---------|------|------|------|------|------|------|
| i   | FLEECE    | heed    | 343  | 2323 | 3005 | 437  | 2761 | 3378 |
| ɪ   | KIT       | hid     | 429  | 2034 | 2687 | 484  | 2369 | 3057 |
| eɪ  | FACE      | hayed   | 476  | 2090 | 2688 | 535  | 2526 | 3045 |
| ɛ   | DRESS     | head    | 588  | 1803 | 2604 | 727  | 2063 | 2953 |
| æ   | TRAP      | had     | 591  | 1930 | 2595 | 676  | 2335 | 2971 |
| ɑ   | LOT/PALM  | hod     | 756  | 1309 | 2535 | 921  | 1524 | 2832 |
| ɔ   | THOUGHT   | hawed   | 656  | 1023 | 2521 | 804  | 1188 | 2824 |
| oʊ  | GOAT      | hoed    | 498  | 910  | 2459 | 555  | 1036 | 2828 |
| ʊ   | FOOT      | hood    | 469  | 1123 | 2435 | 519  | 1229 | 2829 |
| u   | GOOSE     | who'd   | 380  | 992  | 2355 | 460  | 1106 | 2735 |
| ʌ   | STRUT     | hud     | 621  | 1181 | 2548 | 760  | 1416 | 2901 |
| ɝ   | NURSE     | heard   | 475  | 1379 | 1708 | 524  | 1588 | 1931 |

### Modern Israeli Hebrew

Aronson, Rosenhouse, Rosenhouse & Podoshin (1996), "An acoustic analysis of
modern Hebrew vowels and voiced consonants," *Journal of Phonetics* 24:283–293.
Five-vowel system, vowels produced **in isolation**.

**Confidence caveat — read this before trusting the numbers.** n = 6 male and 6
female speakers, and isolated vowels are more peripheral (more extreme) than
vowels in running speech. This is a much weaker dataset than Hillenbrand's.
Expect the real targets in connected Hebrew speech to sit somewhat more central
than the table says. Values in Hz.

| IPA | ♂ F1 | ♂ F2 | ♂ F3 | ♀ F1 | ♀ F2 | ♀ F3 |
|-----|------|------|------|------|------|------|
| i   | 300  | 2670 | 3320 | 325  | 2715 | 3130 |
| e   | 470  | 2185 | 2470 | 540  | 2325 | 3075 |
| a   | 710  | 1232 | 2720 | 880  | 1530 | 2995 |
| o   | 442  | 866  | 2268 | 523  | 984  | 2965 |
| u   | 320  | 784  | 2576 | 384  | 886  | 2945 |

If a value reads wrong in use, **edit it in `vowelData.ts`**. There is no
calibration UI and no persistence — the source file is the single point of truth,
by explicit decision.

### Voice selector

A ♂/♀ toggle switches which column set the overlay uses. Justified because real
data exists for both sexes in both languages, so it costs one control and removes
the entire class of "these numbers don't match my voice" confusion. Default: ♂.

## Architecture

**Entirely frontend.** No Python changes, no new backend endpoints, no new
Python dependencies, no model downloads. Web Audio covers both synthesis and
analysis.

```
frontend/src/
  vowelData.ts        reference sets (en|he × m|f) + types. Pure data.
  lpc.ts              pure DSP math: autocorrelation, Levinson-Durbin,
                      Durand-Kerner root finding, root→formant conversion.
  formantTracker.ts   mic stream → frames → lpc.ts → smoothing → F1/F2/F3.
                      Owns getUserMedia + AnalyserNode + the rAF loop.
  vowelSynth.ts       source-filter synth. start/stop/setFormants/setPitch/setGain.
  VowelChart.tsx      SVG pad: axes, overlay points + labels, target ring,
                      live dot, drag handling.
  VowelStudio.tsx     the tab. Composes chart + controls, owns mode state.
```

CSS goes in `styles.css` alongside everything else (existing convention — the
project keeps one stylesheet, no CSS modules).

`App.tsx` gains a `mainView: "transcript" | "vowels"` state and renders a tab bar
above the main area. The `.tab-bar` / `.tab` rules already exist in `styles.css`,
orphaned from the old Transcript/Pronunciation tabs — reuse them.

### Why not AudioWorklet

`AnalyserNode.getFloatTimeDomainData()` polled from a `requestAnimationFrame`
loop is sufficient: order-12 LPC over a 1024-sample frame at 60 Hz is negligible
CPU. AudioWorklet would move it off the main thread but adds a separate module
loading path and depends on WebKitGTK's AudioWorklet support, which is the
riskier surface of the two platforms. One code path, both platforms.

Revisit only if profiling shows the rAF loop causing dropped frames.

## Synthesis (`vowelSynth.ts`)

Classic cascade source-filter model:

```
OscillatorNode(sawtooth, f = pitch)
  → BiquadFilter(bandpass, f = F1, Q = F1/B1)
  → BiquadFilter(bandpass, f = F2, Q = F2/B2)
  → BiquadFilter(bandpass, f = F3, Q = F3/B3)
  → GainNode(makeup)  → GainNode(master)  → destination
```

- A sawtooth approximates the glottal source's harmonic-rich spectrum with its
  natural −6 dB/octave rolloff. Good enough; a custom `PeriodicWave` shaped to a
  glottal pulse is a possible refinement, not a requirement.
- Nominal formant bandwidths: **B1 = 70, B2 = 100, B3 = 150 Hz** — so Q = F/B.
- Cascaded bandpasses lose a lot of level; the makeup gain compensates. Tune by
  ear so a mid-central vowel at default volume is comfortable.
- **All parameter changes use `setTargetAtTime` / short ramps (~20 ms).** Stepping
  an `AudioParam` directly clicks, and while dragging the pad the formants change
  every frame.
- Start/stop apply a ~20 ms attack/release gain envelope for the same reason.

Controls exposed, matching the reference tool: Pitch (Hz), Volume, F1, F2, F3.

## Live formant tracking (`formantTracker.ts` + `lpc.ts`)

Pipeline, per analysis frame:

1. **Capture.** `getUserMedia` with **`echoCancellation: false`,
   `noiseSuppression: false`, `autoGainControl: false`.** These default to *on*
   and actively distort formant structure. Getting this wrong produces a tracker
   that is subtly, silently wrong rather than obviously broken — it is the single
   highest-risk line in the feature.
2. **Frame.** `AnalyserNode` (`fftSize` 2048) → `getFloatTimeDomainData` into a
   ~1024-sample buffer, pulled on `requestAnimationFrame`.
3. **Voicing gate.** Compute frame RMS. Below threshold → emit "no voice", dim
   the dot, and skip the rest. Prevents the tracker chasing room noise.
4. **Decimate** to ~10 kHz (simple FIR lowpass then take every Nth sample), so an
   order-12 LPC models only 0–5 kHz, where F1–F3 live. Running LPC at 44.1/48 kHz
   wastes poles on high-frequency structure we don't care about.
5. **Pre-emphasis**, `y[n] = x[n] − 0.97·x[n−1]`, to flatten the source tilt.
6. **Hamming window.**
7. **Autocorrelation → Levinson-Durbin** → LPC coefficients, order 12.
8. **Root-find** the LPC polynomial (Durand-Kerner; ~30 lines, ample at order 12).
9. **Roots → formants.** `f = atan2(im, re)·fs/2π`, `bw = −ln|r|·fs/π`.
10. **Select.** Keep roots with `90 < f < 5000` and `bw < 400`; sort ascending;
    take the first three as F1/F2/F3.
11. **Smooth.** Median-of-5 per formant, then EMA (α ≈ 0.25).

**Step 11 is what makes or breaks the feature.** Raw frame-to-frame LPC output
swings ±150 Hz on a steady vowel; unsmoothed, the dot vibrates and reads as
broken rather than as informative. Median-then-EMA kills both impulsive
octave-jump errors and general jitter. The exact constants need tuning against
real speech.

The tracker **releases the mic** (`stream.getTracks().forEach(t => t.stop())`) on
tab exit and on unmount, so it cannot contend with the existing Recorder.

## Chart (`VowelChart.tsx`)

**SVG, not canvas.** Few elements, needs text labels, hover affordances and hit
testing — all of which SVG gives for free, and it stays crisp at any window size.

**Axis orientation** follows the standard phonetic convention (and the reference
tool): **F1 on the vertical axis increasing downward**, **F2 on the horizontal
axis increasing leftward**. This makes high/front vowels land top-left and the
vowel space resemble the IPA quadrilateral.

**Axis scale: Bark, not linear.** Linear Hz axes crowd the high vowels — /i ɪ ʊ u/
all compress into a thin strip at the top, which is exactly where the
distinctions a learner needs are. Bark spacing approximates auditory resolution,
so equal visual distance ≈ equal perceptual distance, and the plotted space comes
out shaped like the IPA quadrilateral.

Use the Traunmüller (1990) approximation:

```
bark(f) = 26.81·f / (1960 + f) − 0.53
```

Axis ranges are computed from the union of all overlay points plus padding, so
both language overlays fit the same frame without rescaling when you switch.

Rendered layers, back to front: axes and gridlines → overlay points with IPA
labels → target ring (practice mode) → live dot / drag cursor.

## Interaction

Two modes sharing one chart.

**Explore.** Drag anywhere on the pad. Pointer position sets F1/F2 (F3 from its
slider); the synth plays continuously while dragging. This is the reference
tool's behaviour.

**Practice.** Click an overlay vowel to make it the target — it gets a ring.
Then:

- **Hold `Space`** → the synth plays the target vowel at the current pitch, and
  the mic is suspended.
- **Release** → the synth stops, the mic resumes, and your live dot tracks.

The two never run at once, so speaker output can never leak into the mic and get
tracked as if it were your voice. No headphones required, no echo cancellation
needed (which is fortunate, since we must disable it — see step 1 above).

Readout while practising: **ΔF1 and ΔF2 in Hz** (signed, so it says which way to
move), plus a proximity indicator that goes green inside tolerance. Hz is shown
rather than Bark because the numbers must line up with the F1/F2 sliders. Initial
tolerance: within ~10 % of each target formant; expect to tune this.

## Testing

The repo currently has no test runner. Add **vitest** (one devDependency; Vite is
already present, so config is minimal).

`lpc.ts` is pure, deterministic, and the single most likely place for a silent
bug — a subtly wrong root solver just looks like "the dot is jumpy," which is
indistinguishable from insufficient smoothing. Test it directly:

- Synthesize a signal by passing a known impulse train through known formant
  resonators, run the tracker over it, assert recovered F1/F2 are within ~5 %.
- Levinson-Durbin against a hand-computed small case.
- Durand-Kerner against polynomials with known roots.
- `bark()` against published reference values.

`vowelData.ts` gets a shape/sanity test (all entries present, F1 < F2 < F3, values
in plausible ranges).

The audio-dependent parts (`vowelSynth`, `formantTracker`'s stream handling) are
not unit-tested — they need a real audio device and a real window. They get
verified by hand in the running app.

## Verification plan

Automated: `npx tsc --noEmit`, `npm run build`, `npx vitest run`.

Manual, in the running app (must be done by the user — the pywebview GUI can't be
driven from a coding session):

1. Explore mode makes a recognisable vowel sound that changes plausibly as the
   pad is dragged.
2. Overlay points land where the tables say, and switching en↔he and ♂↔♀ moves
   them coherently.
3. Sustaining an /a/ into the mic parks the dot near the /a/ overlay point and it
   stays reasonably still.
4. Sweeping /i/→/a/→/u/ traces a smooth arc, not a scatter of jumps.
5. Hold-Space plays the target and the mic goes quiet; release restores tracking.
6. Leaving the tab releases the mic — the OS mic indicator goes out, and the
   Recorder still works afterwards.

## Risks

| Risk | Handling |
|---|---|
| Browser DSP (AGC/NS/AEC) silently distorts formants | Explicitly disabled in the `getUserMedia` constraints; called out as the highest-risk line |
| Tracker too jittery to be usable | Median+EMA smoothing; constants tuned against real speech; unit tests isolate solver bugs from smoothing shortfalls |
| WebKitGTK Web Audio gaps on Linux | Avoided AudioWorklet entirely; only long-stable Web Audio APIs used |
| LPC picks a spurious low root, F1/F2 swap | Bandwidth (<400 Hz) and frequency-range filters before selection |
| Hebrew reference data is weak (n=6, isolated vowels) | Stated in the UI as well as here; values are one edit away in `vowelData.ts` |
| Cascaded bandpass output too quiet or harsh | Explicit makeup gain, tuned by ear |

## Decisions taken (and what was rejected)

- **Standalone tool, no session integration.** Rejected: plotting vowels from
  recorded audio; wiring vowels to transcript words. Both remain possible later.
- **Call-and-response (hold-to-hear, release-to-speak).** Rejected: simultaneous
  drone + tracking (needs headphones, silently misbehaves on speakers) and two
  fully separate tabs (loses the match-the-target loop).
- **Static reference data, no calibration, no persistence.** Rejected: drag-a-point
  to recalibrate and save. Corrections happen in the source file.
- **Bark axes.** Rejected: linear Hz axes as in the reference tool.
- **♂/♀ reference switch.** Added because real data for both already exists.
- **Frontend-only, no AudioWorklet.** Rejected: Python-side DSP; worklet-based
  analysis.
