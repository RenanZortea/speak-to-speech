import { useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import { FormantTracker, type TrackedFormants } from "./formantTracker";
import { VowelChart } from "./VowelChart";
import { VOWEL_DATA, type VoiceSex, type VowelLanguage, type VowelReference } from "./vowelData";
import { VowelSynth } from "./vowelSynth";

export function VowelStudio() {
  const [mode, setMode] = useState<"explore" | "practice">("explore");
  const [language, setLanguage] = useState<VowelLanguage>("en");
  const [sex, setSex] = useState<VoiceSex>("m");
  const [formants, setFormants] = useState({ f1: 500, f2: 1500, f3: 2500 });
  const [pitch, setPitch] = useState(120);
  const [volume, setVolume] = useState(1);
  const [target, setTarget] = useState<VowelReference | null>(null);
  const [live, setLive] = useState<TrackedFormants | null>(null);
  const [micError, setMicError] = useState("");
  const synth = useRef(new VowelSynth());
  const tracker = useRef<FormantTracker | null>(null);
  const vowels = VOWEL_DATA[language][sex];

  useEffect(() => { synth.current.setFormants(formants); }, [formants]);
  useEffect(() => { synth.current.setPitch(pitch); }, [pitch]);
  useEffect(() => { synth.current.setGain(volume); }, [volume]);
  useEffect(() => () => { tracker.current?.stop(); synth.current.dispose(); }, []);
  useEffect(() => {
    synth.current.stop();
    tracker.current?.stop();
    tracker.current = null;
    setLive(null);
    let next: FormantTracker | null = null;
    if (mode === "practice") {
      next = new FormantTracker(setLive);
      tracker.current = next;
      void next.start().then(() => setMicError("")).catch((error: unknown) => setMicError((error as Error).message));
    }
    return () => { next?.stop(); if (tracker.current === next) tracker.current = null; };
  }, [mode]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (mode !== "practice" || event.code !== "Space" || event.repeat || !target || isEditable(event.target)) return;
      event.preventDefault(); tracker.current?.suspend(); synth.current.setFormants(target); void synth.current.start();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || mode !== "practice") return;
      event.preventDefault(); synth.current.stop(); tracker.current?.resume();
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); synth.current.stop(); };
  }, [mode, target]);

  const delta = target && live ? { f1: live.f1 - target.f1, f2: live.f2 - target.f2 } : null;
  const close = !!delta && Math.abs(delta.f1) <= target!.f1 * 0.1 && Math.abs(delta.f2) <= target!.f2 * 0.1;
  return <div className="vowel-studio">
    <div className="vowel-toolbar">
      <div className="segmented"><button className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")}>Explore</button><button className={mode === "practice" ? "active" : ""} onClick={() => setMode("practice")}>Practice</button></div>
      <label>Overlay <select value={language} onChange={(e) => { setLanguage(e.target.value as VowelLanguage); setTarget(null); }}><option value="en">General American English</option><option value="he">Modern Israeli Hebrew</option></select></label>
      <div className="segmented"><button className={sex === "m" ? "active" : ""} onClick={() => { setSex("m"); setTarget(null); }}>♂</button><button className={sex === "f" ? "active" : ""} onClick={() => { setSex("f"); setTarget(null); }}>♀</button></div>
    </div>
    <div className="vowel-workspace">
      <VowelChart vowels={vowels} cursor={formants} live={live} target={target} practice={mode === "practice"}
        onCursorChange={(p) => setFormants((old) => ({ ...old, f1: Math.round(p.f1), f2: Math.round(p.f2) }))}
        onDragStart={() => void synth.current.start()} onDragEnd={() => synth.current.stop()}
        onTarget={(vowel) => { setTarget(vowel); setFormants({ f1: vowel.f1, f2: vowel.f2, f3: vowel.f3 }); }} />
      <aside className="vowel-controls">
        <h2>{mode === "explore" ? <><Volume2 size={18}/> Vowel synth</> : <><Mic size={18}/> Match the target</>}</h2>
        <Slider label="Volume" value={volume * 100} min={0} max={150} step={1} unit="%" onChange={(value) => setVolume(value / 100)}/>
        {mode === "practice" && <div className={`practice-readout ${close ? "close" : ""}`}><strong>{target ? `/${target.ipa}/ ${target.keyword ?? ""}` : "Choose a vowel on the chart"}</strong>{target && <span>Hold Space to hear · release to speak</span>}{delta && <code>ΔF1 {signed(delta.f1)} Hz<br/>ΔF2 {signed(delta.f2)} Hz</code>}{micError && <span className="vowel-error">Mic: {micError}</span>}</div>}
        <Slider label="Pitch" value={pitch} min={70} max={260} unit="Hz" onChange={setPitch}/>
        <Slider label="F1" value={formants.f1} min={200} max={1100} unit="Hz" onChange={(f1) => setFormants((v) => ({...v, f1}))}/>
        <Slider label="F2" value={formants.f2} min={600} max={3000} unit="Hz" onChange={(f2) => setFormants((v) => ({...v, f2}))}/>
        <Slider label="F3" value={formants.f3} min={1500} max={3800} unit="Hz" onChange={(f3) => setFormants((v) => ({...v, f3}))}/>
        {language === "he" && <p className="vowel-caveat">Hebrew targets are based on 6 speakers per group and isolated vowels; connected speech is usually more central.</p>}
      </aside>
    </div>
  </div>;
}

function Slider({ label, value, min, max, step = 1, unit = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void }) {
  return <label className="opt"><span className="opt-head"><span className="opt-label">{label}</span><span className="opt-value">{Math.round(value * 100) / 100} {unit}</span></span><input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))}/></label>;
}
function signed(value: number): string { return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value))}`; }
function isEditable(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement; }
