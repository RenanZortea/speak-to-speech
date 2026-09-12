import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, X } from "lucide-react";
import { api, type NativeAudioDevices } from "./api";
import { microphoneDevice, speakerDevice, nativeMicrophone, nativeSpeaker, desktopDevice, recordingSource, refreshNativeDevices, selectSpeaker, type RecordingSource } from "./audioDevices";

export function AudioDeviceSettings() {
  const [panel, setPanel] = useState<"microphone" | "speaker" | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [native, setNative] = useState<NativeAudioDevices | null>(null);
  const [input, setInput] = useState(microphoneDevice);
  const [output, setOutput] = useState(speakerDevice);
  const [desktop, setDesktop] = useState(desktopDevice);
  const [source, setSource] = useState(recordingSource);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const outputSupported = native?.supported || (typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype);

  useEffect(() => {
    let active = true;
    void refreshNativeDevices().then(async (result) => {
      if (!active) return;
      setNative(result);
      if (result.supported) {
        setInput(nativeMicrophone());
        setOutput(nativeSpeaker());
        await api.setAudioOutput(nativeSpeaker());
      }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not initialize audio devices."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!panel) return;
    let active = true;
    root.current?.querySelector<HTMLSelectElement>("select")?.focus();
    const refresh = async () => {
      try {
        if (native?.supported) {
          const result = await refreshNativeDevices();
          if (active) { setNative(result); if (result.error) setError(result.error); }
        } else if (navigator.mediaDevices?.enumerateDevices) {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (active) setDevices(list);
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not list audio devices."); }
    };
    void refresh();
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setPanel(null); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setPanel(null); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    const element = root.current;
    element?.addEventListener("keydown", escape);
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      document.removeEventListener("pointerdown", outside);
      element?.removeEventListener("keydown", escape);
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [panel, native?.supported]);

  const run = async (action: () => Promise<void>) => {
    setLoading(true); setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not change audio settings."); }
    finally { setLoading(false); }
  };
  const changeOutput = async (value: string) => {
    if (native?.supported) {
      await api.setAudioOutput(value);
      localStorage.setItem("nativeSpeaker", value);
    } else await selectSpeaker(value);
    setOutput(value);
  };
  const allowDevices = () => run(async () => {
    if (native?.supported) { setNative(await refreshNativeDevices()); return; }
    const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
    if (panel === "speaker" && media.selectAudioOutput) {
      const device = await media.selectAudioOutput();
      await changeOutput(device.deviceId);
    } else {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    setDevices(await media.enumerateDevices());
  });
  const microphone = panel === "microphone";
  const selected = microphone ? input : output;
  const options = native?.supported
    ? (microphone ? native.inputs : native.outputs) || []
    : devices.filter((d) => d.kind === (microphone ? "audioinput" : "audiooutput") && d.deviceId && d.deviceId !== "default")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${microphone ? "Microphone" : "Speaker"} ${i + 1}` }));

  return <div className="audio-device-settings" ref={root}>
    {(["microphone", "speaker"] as const).map((kind) => <button key={kind} type="button"
      className="res-settings" title={`${kind === "microphone" ? "Microphone" : "Speaker"} settings`}
      aria-label={`${kind === "microphone" ? "Microphone" : "Speaker"} settings`}
      aria-expanded={panel === kind} aria-controls={panel === kind ? "audio-device-panel" : undefined}
      onClick={(event) => { trigger.current = event.currentTarget; setPanel(panel === kind ? null : kind); }}>
      {kind === "microphone" ? <Mic size={16} /> : <Volume2 size={16} />}
    </button>)}
    {panel && <section className="audio-device-panel" id="audio-device-panel" aria-label={`${microphone ? "Microphone" : "Speaker"} settings`}>
      <div className="audio-device-heading"><strong>{microphone ? "Recording" : "Speaker"} settings</strong>
        <button type="button" className="res-settings" aria-label="Close audio settings" onClick={() => { setPanel(null); trigger.current?.focus(); }}><X size={14} /></button>
      </div>
      {microphone && <>
        <label htmlFor="recording-source">Record audio from</label>
        <select id="recording-source" value={source} onChange={(event) => {
          const value = event.target.value as RecordingSource;
          localStorage.setItem("recordingSource", value); setSource(value);
        }}>
          <option value="microphone">Microphone</option>
          <option value="desktop">Desktop audio</option>
          <option value="both">Desktop + microphone</option>
        </select>
        <p>{source === "both" ? "Capture the conversation and your voice together. Use headphones to avoid echo." : source === "desktop" ? "Capture audio playing on your desktop." : "Capture your voice from the selected microphone."}</p>
      </>}
      {(!microphone || source !== "desktop") && <>
        <label htmlFor="audio-device-select">{microphone ? "Microphone" : "Output device"}</label>
        <select id="audio-device-select" value={selected} disabled={loading || (!microphone && !outputSupported)}
          onChange={(event) => {
            const value = event.target.value;
            if (microphone) { localStorage.setItem(native?.supported ? "nativeMicrophone" : "microphoneDevice", value); setInput(value); }
            else void run(() => changeOutput(value));
          }}>
          <option value="">System default</option>
          {selected && !options.some((d) => d.id === selected) && <option value={selected}>Selected device (unavailable)</option>}
          {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </>}
      {microphone && source !== "microphone" && (native?.supported ? <>
        <label className="audio-desktop-label" htmlFor="desktop-device">Desktop audio device</label>
        <select id="desktop-device" value={desktop} onChange={(event) => { localStorage.setItem("desktopDevice", event.target.value); setDesktop(event.target.value); }}>
          <option value="">System default output</option>
          {desktop && !native.outputs?.some((d) => d.id === desktop) && <option value={desktop}>Selected device (unavailable)</option>}
          {native.outputs?.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <p>Choose the output your conversation app plays through.</p>
        {!native.capture && <p role="alert">Install ffmpeg to enable desktop capture.</p>}
      </> : <p>When recording starts, choose a screen or tab and enable audio sharing. Available sources depend on your browser.</p>)}
      <p>{microphone ? "Changes apply to your next recording." : native?.supported ? "Routes this app’s playback to the selected speaker." : outputSupported ? "Applies to recorded and imported audio playback." : "Speaker selection is unavailable. Use system sound settings."}</p>
      {(microphone || outputSupported) && <button type="button" className="btn" disabled={loading} onClick={allowDevices}>{loading ? "Working…" : native?.supported ? "Refresh devices" : microphone ? "Allow access / refresh devices" : "Choose / allow speaker"}</button>}
      {(error || native?.error) && <p role="alert">{error || native?.error}</p>}
    </section>}
  </div>;
}
