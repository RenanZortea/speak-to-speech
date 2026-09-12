# Player and transcript interaction spec

## Audio
- One WaveSurfer instance owns playback, seeking, speed and volume for a loaded source.
- Use decoded Web Audio playback in the GTK desktop runtime, with gain-based volume.
- Source changes reset readiness and looping; view changes do not destroy playback.
- Surface loading/play errors and allow retry rather than leaving an inert play button.
- Use 3px waveform bars and 2px gaps, roughly doubling the current density.

## Modes
- Transcribe and Vowel practice are exclusive accessible tab panels.
- Arrow keys, Home and End select and focus tabs.
- Shared audio transport stays mounted across mode changes; vowel practice replaces the transcription stage.
- Returning to Transcribe preserves the recording, transcript and playback position.

## Transcript
- Before words arrive, show the waveform.
- Once transcription contains segments, crossfade in a lyrics-style transcript in the same stage.
- Highlight the current segment and its timed words; smoothly center each new active segment.
- Clicking a lyric seeks playback. Support RTL text and segments without word timestamps.
- Keep the existing correction editor available through a Lyrics / Edit transcript switch.
- Keep transport and actions below the stage. Respect reduced-motion preferences.

## Validation
- Production build and existing tests must pass.
- Add regression coverage for lyric timing and contextual playback rendering.
- Desktop sound output and animation need runtime verification; do not equate compilation with audible playback.
