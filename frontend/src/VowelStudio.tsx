import { useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import { FormantTracker, type TrackedFormants } from "./formantTracker";
import { VowelChart } from "./VowelChart";
import { VOWEL_DATA, type VoiceSex, type VowelLanguage, type VowelReference } from "./vowelData";
import { VowelSynth } from "./vowelSynth";

interface Props {
  playbackFormants: TrackedFormants | null;
  playbackActive: boolean;
  hasRecording: boolean;
  languageHint: string;
}

export function VowelStudio({ playbackFormants, playbackActive, hasRecording, languageHint }: Props) {
  const [mode, setMode] = useState<"explore" | "practice">("explore");
  const [language, setLanguage] = useState<VowelLanguage>(() => vowelLanguage(languageHint));
  const [sex, setSex] = useState<VoiceSex>("m");
  const [formants, setFormants] = useState({ f1: 500, f2: 1500, f3: 2500 });
  const [pitch, setPitch] = useState(120);
  const [volume, setVolume] = useState(1);
  const [target, setTarget] = useState<VowelReference | null>(null);
  const [micLive, setMicLive] = useState<TrackedFormants | null>(null);
  const [micError, setMicError] = useState("");
  const synth = useRef(new VowelSynth());
  const tracker = useRef<FormantTracker | null>(null);
  const vowels = VOWEL_DATA[language][sex];

  useEffect(() => { setLanguage(vowelLanguage(languageHint)); setTarget(null); }, [languageHint]);
  useEffect(() => { synth.current.setFormants(formants); }, [formants]);
  useEffect(() => { synth.current.setPitch(pitch); }, [pitch]);
  useEffect(() => { synth.current.setGain(volume); }, [volume]);
  useEffect(() => () => { tracker.current?.stop(); synth.current.dispose(); }, []);
  useEffect(() => {
    synth.current.stop();
    tracker.current?.stop();
    tracker.current = null;
    setMicLive(null);
    let next: FormantTracker | null = null;
    if (mode === "practice" && !playbackActive) {
      next = new FormantTracker(setMicLive);
      tracker.current = next;
      void next.start().then(() => setMicError("")).catch((error: unknown) => setMicError((error as Error).message));
    }
    return () => { next?.stop(); if (tracker.current === next) tracker.current = null; };
  }, [mode, playbackActive]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (mode !== "practice" || playbackActive || event.code !== "Space" || !target || isEditable(event.target)) return;
      // Held keys repeat: suppress scrolling on every event, but start audio once.
      event.preventDefault();
      if (event.repeat) return;
      tracker.current?.suspend(); synth.current.setFormants(target); void synth.current.start();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || mode !== "practice") return;
      event.preventDefault(); synth.current.stop(); tracker.current?.resume();
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); synth.current.stop(); };
  }, [mode, target, playbackActive]);

  const displayedLive = playbackActive ? playbackFormants : micLive;
  const delta = target && displayedLive ? { f1: displayedLive.f1 - target.f1, f2: displayedLive.f2 - target.f2 } : null;
  const close = !!delta && Math.abs(delta.f1) <= target!.f1 * 0.1 && Math.abs(delta.f2) <= target!.f2 * 0.1;
  const guidance = target && delta ? articulatoryGuidance(delta, target) : [];
  return <div className="vowel-studio">
    <header className="vowel-heading">
      <h1>Vowels</h1>
      <p>Explore a sound. Find your voice.</p>
    </header>
    <div className="vowel-toolbar">
      <div className="segmented"><button aria-pressed={mode === "explore"} className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")}>Explore</button><button aria-pressed={mode === "practice"} className={mode === "practice" ? "active" : ""} onClick={() => setMode("practice")}>Practice</button></div>
      <label><span>Language</span> <select value={language} onChange={(e) => { setLanguage(e.target.value as VowelLanguage); setTarget(null); }}><option value="en">General American English</option><option value="he">Modern Israeli Hebrew</option><option value="ar-Jerusalem">Palestinian Arabic (Jerusalem)</option><option value="pt-BR">Brazilian Portuguese</option></select></label>
      <div className="segmented"><button aria-label="Male reference voice" aria-pressed={sex === "m"} className={sex === "m" ? "active" : ""} onClick={() => { setSex("m"); setTarget(null); }}>Male</button><button aria-label="Female reference voice" aria-pressed={sex === "f"} className={sex === "f" ? "active" : ""} onClick={() => { setSex("f"); setTarget(null); }}>Female</button></div>
    </div>
    <div className="vowel-workspace">
      <div className="vowel-stage">
      <p className="vowel-instruction">{playbackActive ? "Follow the vowels in your recording" : mode === "explore" ? "Drag across the chart to hear a vowel" : "Choose a vowel, then speak to match it"}</p>
      <VowelChart vowels={vowels} cursor={formants} live={displayedLive} target={target} practice={mode === "practice"}
        onCursorChange={(p) => setFormants((old) => ({ ...old, f1: Math.round(p.f1), f2: Math.round(p.f2) }))}
        onDragStart={() => void synth.current.start()} onDragEnd={() => synth.current.stop()}
        onTarget={(vowel) => { setTarget(vowel); setFormants({ f1: vowel.f1, f2: vowel.f2, f3: vowel.f3 }); }} />
      {hasRecording && <p className={`playback-analysis-state ${playbackActive ? "active" : ""}`} role="status">{playbackActive ? "Analyzing recording…" : "Play your recording to see its vowels here"}</p>}
      </div>
      <aside className="vowel-controls" aria-label="Vowel sound controls">
        <h2>{playbackActive ? <><Volume2 size={18}/> Recording analysis</> : mode === "explore" ? <><Volume2 size={18}/> Vowel synth</> : <><Mic size={18}/> Match the target</>}</h2>
        <div className="vowel-primary-controls">
        <Slider label="Volume" value={volume * 100} min={0} max={150} step={1} unit="%" onChange={(value) => setVolume(value / 100)}/>
        <Slider label="Pitch" value={pitch} min={70} max={260} unit="Hz" onChange={setPitch}/>
        </div>
        {playbackActive && mode === "explore" && <div className="practice-readout"><strong>Recorded audio</strong>{displayedLive ? <code>F1 {Math.round(displayedLive.f1)} · F2 {Math.round(displayedLive.f2)} · F3 {Math.round(displayedLive.f3)} Hz</code> : <span>No measurable vowel in this frame</span>}<span>Loop a word or vowel for a steadier reading.</span></div>}
        {mode === "practice" && <div className={`practice-readout ${close ? "close" : ""}`}><strong>{target ? `/${target.ipa}/ ${target.keyword ?? ""}` : "Choose a vowel on the chart"}</strong>{target && !playbackActive && <span>Hold Space to hear · release to speak</span>}{displayedLive && <code>{playbackActive ? "Recording" : "Live"} F1 {Math.round(displayedLive.f1)} · F2 {Math.round(displayedLive.f2)} · F3 {Math.round(displayedLive.f3)} Hz</code>}{delta && <code>ΔF1 {signed(delta.f1)} Hz<br/>ΔF2 {signed(delta.f2)} Hz</code>}{guidance.map((hint) => <span className="vowel-guidance" key={hint}>{hint}</span>)}{micError && <span className="vowel-error">Mic: {micError}</span>}</div>}
        <details className="vowel-adjustments">
          <summary>Sound adjustments <span>F1 · F2 · F3</span></summary>
          <div className="vowel-formant-controls">
        <Slider label="F1" value={formants.f1} min={200} max={1100} unit="Hz" onChange={(f1) => setFormants((v) => ({...v, f1}))}/>
        <Slider label="F2" value={formants.f2} min={600} max={3000} unit="Hz" onChange={(f2) => setFormants((v) => ({...v, f2}))}/>
        <Slider label="F3" value={formants.f3} min={1500} max={3800} unit="Hz" onChange={(f3) => setFormants((v) => ({...v, f3}))}/>
          </div>
        </details>
      </aside>
      <footer className="vowel-notes">
        {language === "he" && <p className="vowel-caveat">Hebrew targets are based on 6 speakers per group and isolated vowels; connected speech is usually more central.</p>}
        {language === "ar-Jerusalem" && <p className="vowel-caveat">Jerusalem approximation: short and long vowel targets are pooled from 80 central/northern Palestinian Arabic speakers; Jerusalem-specific norms were not available. F3 is a synthesis default.</p>}
        {language === "pt-BR" && <p className="vowel-caveat">Brazilian Portuguese targets are based on sustained vowels from 23 speakers per group; connected speech varies by stress and dialect.</p>}
      </footer>
    </div>
  </div>;
}

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void }) {
  return <label className="opt"><span className="opt-head"><span className="opt-label">{label}</span><span className="opt-value">{Math.round(value * 100) / 100} {unit}</span></span><input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))}/></label>;
}
function signed(value: number): string { return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value))}`; }
function vowelLanguage(language: string): VowelLanguage {
  if (language === "he") return "he";
  if (language === "ar" || language.toLowerCase().startsWith("ar-")) return "ar-Jerusalem";
  if (language === "pt" || language.toLowerCase().startsWith("pt-")) return "pt-BR";
  return "en";
}
function articulatoryGuidance(delta: { f1: number; f2: number }, target: VowelReference): string[] {
  const hints: string[] = [];
  if (delta.f1 < -target.f1 * 0.1) hints.push("Open slightly ↓");
  else if (delta.f1 > target.f1 * 0.1) hints.push("Close slightly ↑");
  if (delta.f2 < -target.f2 * 0.1) hints.push("Move your tongue forward ←");
  else if (delta.f2 > target.f2 * 0.1) hints.push("Move your tongue back →");
  if (hints.length === 0) hints.push("On target");
  return hints;
}
function isEditable(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement; }
