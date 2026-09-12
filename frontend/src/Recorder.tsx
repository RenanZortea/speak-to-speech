import { useEffect, useRef, useState } from "react";
import { microphoneDevice, nativeMicrophone, desktopDevice, recordingSource, nativeCaptureAvailable, isLinuxDesktop, requireNativeCapture } from "./audioDevices";
import { captureAudio, type AudioCapture } from "./captureAudio";
import { api } from "./api";
import { LiveWaveform } from "./LiveWaveform";
import { Mic, Square, Loader2, X, Trash2, Pause, Play } from "lucide-react";

interface Props {
  serverUrl: string | null;
  disabled: boolean;
  onRecordingReady: (path: string, url: string) => void;
}

type RecState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "paused"; durationMs: number }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

export function useRecorder({ serverUrl, disabled, onRecordingReady }: Props) {
  const [state, setState] = useState<RecState>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancellingRef = useRef(false);
  const captureRef = useRef<AudioCapture | null>(null);
  const nativeRef = useRef(false);
  const mountedRef = useRef(true);
  const finishingRef = useRef(false);

  const releaseCapture = () => {
    captureRef.current?.close();
    captureRef.current = null;
    streamRef.current = null;
  };

  useEffect(() => {
    if (state.kind !== "recording") return;
    const startedAt = state.startedAt;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCapture();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      if (nativeRef.current) { nativeRef.current = false; void api.stopAudioRecording(true).catch(() => {}); }
    };
  }, []);

  useEffect(() => {
    if (!["recording", "paused"].includes(state.kind) || !nativeRef.current) return;
    let active = true;
    let pending = false;
    const id = window.setInterval(async () => {
      if (pending || finishingRef.current) return;
      pending = true;
      try {
        const result = await api.audioRecordingStatus();
        if (active && !finishingRef.current && result.error) {
          nativeRef.current = false;
          setState({ kind: "error", message: result.error });
        }
      } catch (error) {
        if (active && !finishingRef.current) {
          nativeRef.current = false;
          void api.stopAudioRecording(true).catch(() => {});
          setState({ kind: "error", message: (error as Error).message });
        }
      } finally { pending = false; }
    }, 500);
    return () => { active = false; window.clearInterval(id); };
  }, [state.kind]);

  const startingRef = useRef(false);
  const start = async (): Promise<boolean> => {
    if (!serverUrl || disabled || startingRef.current || !["idle", "error"].includes(state.kind)) return false;
    startingRef.current = true;
    setState({ kind: "requesting" });
    try {
      const linuxDesktop = isLinuxDesktop();
      if (linuxDesktop) await requireNativeCapture();
      if (!mountedRef.current) return false;
      if (linuxDesktop || nativeCaptureAvailable()) {
        await api.startAudioRecording(recordingSource(), nativeMicrophone(), desktopDevice());
        if (!mountedRef.current) { await api.stopAudioRecording(true); return false; }
        nativeRef.current = true;
        setState({ kind: "recording", startedAt: Date.now() });
        setElapsed(0);
        return true;
      }
      const capture = await captureAudio(recordingSource(), microphoneDevice());
      if (!mountedRef.current) { capture.close(); return false; }
      captureRef.current = capture;
      const stream = capture.stream;
      streamRef.current = stream;

      chunksRef.current = [];
      cancellingRef.current = false;

      const attach = (mr: MediaRecorder) => {
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = async () => {
          releaseCapture();
          if (!mountedRef.current) return;
          if (cancellingRef.current) {
            // Discarded recording — drop the audio, don't upload/transcribe.
            chunksRef.current = [];
            cancellingRef.current = false;
            setState({ kind: "idle" });
            setElapsed(0);
            return;
          }
          const blob = new Blob(chunksRef.current, { type: mr.mimeType });
          await upload(blob, mr.mimeType);
        };
        mr.onerror = (e) => {
          mr.onstop = null;
          releaseCapture();
          if (mr.state !== "inactive") mr.stop();
          setState({
            kind: "error",
            message: `recorder error: ${(e as any).error?.message ?? "unknown"}`,
          });
        };
      };

      const mr = startRecorder(stream, attach);
      if (!mr) {
        releaseCapture();
        setState({
          kind: "error",
          message:
            "No usable audio encoder. On Linux, install GStreamer plugins " +
            "(gst-plugins-base for opus/vorbis, gst-plugins-good for aac).",
        });
        return false;
      }
      recorderRef.current = mr;
      capture.onEnded(() => { if (mr.state !== "inactive") mr.stop(); });
      setState({ kind: "recording", startedAt: Date.now() });
      setElapsed(0);
      return true;
    } catch (e) {
      releaseCapture();
      if (mountedRef.current) setState({ kind: "error", message: (e as Error).message });
      return false;
    } finally {
      startingRef.current = false;
    }
  };

  const finishNative = async (discard: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setState({ kind: "uploading" });
    try {
      const result = await api.stopAudioRecording(discard);
      if (!mountedRef.current) return;
      if (result && !discard) onRecordingReady(result.path, result.url);
      setState({ kind: "idle" });
      setElapsed(0);
    } catch (e) {
      if (mountedRef.current) setState({ kind: "error", message: (e as Error).message });
    } finally { nativeRef.current = false; finishingRef.current = false; }
  };

  const togglingRef = useRef(false);
  const togglePause = async () => {
    if (togglingRef.current || finishingRef.current || (state.kind !== "recording" && state.kind !== "paused")) return;
    togglingRef.current = true;
    const paused = state.kind === "paused";
    try {
      if (nativeRef.current) await api.pauseAudioRecording(!paused);
      else if (paused) recorderRef.current?.resume();
      else recorderRef.current?.pause();
      if (!mountedRef.current || finishingRef.current) return;
      if (paused) setState({ kind: "recording", startedAt: Date.now() - state.durationMs });
      else {
        const durationMs = Date.now() - state.startedAt;
        setElapsed(Math.floor(durationMs / 1000));
        setState({ kind: "paused", durationMs });
      }
    } catch (error) {
      if (nativeRef.current) { nativeRef.current = false; void api.stopAudioRecording(true).catch(() => {}); }
      else { if (recorderRef.current) recorderRef.current.onstop = null; releaseCapture(); }
      if (mountedRef.current) setState({ kind: "error", message: (error as Error).message });
    } finally { togglingRef.current = false; }
  };

  const stop = () => {
    if (nativeRef.current) { void finishNative(false); return; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  const cancel = () => {
    if (nativeRef.current) { void finishNative(true); return; }
    cancellingRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  const upload = async (blob: Blob, mime: string) => {
    setState({ kind: "uploading" });
    try {
      const ext = extFromMime(mime);
      const res = await fetch(`${serverUrl}/upload`, {
        method: "POST",
        headers: {
          "X-Audio-Ext": ext,
          "Content-Type": "application/octet-stream",
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { path: string; url: string };
      onRecordingReady(data.path, data.url);
      setState({ kind: "idle" });
      setElapsed(0);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const dismissError = () => setState({ kind: "idle" });

  return { state, elapsed, stream: streamRef.current, start, stop, cancel, togglePause, dismissError, canStart: !disabled && !!serverUrl };
}

export type RecordingController = ReturnType<typeof useRecorder>;

export function Recorder({ controller, prominent = false }: { controller: RecordingController; prominent?: boolean }) {
  const { state, elapsed, start, stop, cancel, togglePause, dismissError, canStart } = controller;
  if (prominent) {
    const recording = state.kind === "recording" || state.kind === "paused";
    const waiting = state.kind === "requesting" || state.kind === "uploading";
    return <div className={`record-center ${recording ? "is-recording" : ""}`}>
      <div className="record-orbit">
        <button className="record-main" onClick={recording ? stop : start}
          disabled={waiting || (!recording && !canStart)}
          aria-label={recording ? "Stop recording" : "Start recording"}>
          {waiting ? <Loader2 size={36} className="spin" /> : recording ? <Square size={32} fill="currentColor" /> : <Mic size={40} strokeWidth={1.5} />}
        </button>
      </div>
      <span className="record-caption" role="status">{recording ? `${fmt(elapsed)}${state.kind === "paused" ? " · Paused" : ""}` : state.kind === "requesting" ? "Preparing audio capture…" : state.kind === "uploading" ? "Preparing your audio…" : "Record"}</span>
      {recording && <>
        <button className="btn" onClick={togglePause} aria-label={state.kind === "paused" ? "Resume recording" : "Pause recording"}>
          {state.kind === "paused" ? <Play size={14} /> : <Pause size={14} />}{state.kind === "paused" ? "Resume" : "Pause"}
        </button>
        <LiveWaveform stream={controller.stream} />
        <button className="import-audio" onClick={cancel}><Trash2 size={13} /> Discard recording</button>
      </>}
      {state.kind === "error" && <div className="rec-error" role="alert">
        <span>{state.message}</span>
        <button onClick={dismissError} className="rec-dismiss" aria-label="Dismiss recording error"><X size={14} /></button>
      </div>}
    </div>;
  }
  if (state.kind === "idle") {
    return (
      <button
        onClick={start}
        disabled={!canStart}
        className="btn record"
        title="Record audio"
      >
        <Mic size={16} />
        <span>Record</span>
      </button>
    );
  }

  if (state.kind === "requesting") {
    return (
      <div className="rec-status">
        <Loader2 size={14} className="spin" /> <span>Preparing audio capture…</span>
      </div>
    );
  }

  if (state.kind === "recording" || state.kind === "paused") {
    return (
      <div className="rec-active">
        <LiveWaveform stream={controller.stream} />
        <button onClick={togglePause} className="btn" aria-label={state.kind === "paused" ? "Resume recording" : "Pause recording"}>
          {state.kind === "paused" ? <Play size={14} /> : <Pause size={14} />}
          <span>{state.kind === "paused" ? "Resume" : "Pause"}</span>
        </button>
        <button onClick={stop} className="btn record-stop">
          <Square size={14} fill="currentColor" />
          <span>Stop</span>
        </button>
        <button onClick={cancel} className="btn record-cancel" title="Discard this recording">
          <Trash2 size={14} />
        </button>
        <span className="rec-time">
          {state.kind === "recording" && <span className="rec-pulse" />}
          {fmt(elapsed)}
        </span>
      </div>
    );
  }

  if (state.kind === "uploading") {
    return (
      <div className="rec-status">
        <Loader2 size={14} className="spin" /> <span>Uploading…</span>
      </div>
    );
  }

  return (
    <div className="rec-error">
      <span title={state.message}>Recording error: {state.message}</span>
      <button onClick={dismissError} className="rec-dismiss" title="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

// Build and START a MediaRecorder, choosing a mime type that actually works on
// this platform. WebKitGTK is doubly deceptive here: MediaRecorder.isTypeSupported()
// reports a *container* (e.g. audio/webm) as supported even when the required
// GStreamer audio *encoder* (opus/vorbis) is missing, AND the constructor still
// succeeds — the NotSupportedError ("MediaRecorder unsupported on this platform")
// is only thrown at start(). So neither isTypeSupported nor construction is a
// reliable probe; we must actually try start() and fall through on failure.
// `attach` wires the data/stop/error handlers before we start. Order prefers the
// small opus/webm formats (Chromium/WebView2) and falls back to aac/mp4 (what
// WebKitGTK ships an encoder for). Returns the started recorder, or null.
function startRecorder(
  stream: MediaStream,
  attach: (mr: MediaRecorder) => void,
): MediaRecorder | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/wav",
  ];
  const tryStart = (opts?: MediaRecorderOptions): MediaRecorder | null => {
    try {
      const mr = new MediaRecorder(stream, opts);
      attach(mr);
      mr.start(250); // throws NotSupportedError here if the encoder is missing
      return mr;
    } catch {
      return null;
    }
  };
  for (const c of candidates) {
    if (!MediaRecorder.isTypeSupported(c)) continue;
    const mr = tryStart({ mimeType: c });
    if (mr) return mr;
  }
  // Last resort: let the platform pick its own default container/codec.
  return tryStart();
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
