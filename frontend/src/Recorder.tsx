import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, X } from "lucide-react";

interface Props {
  serverUrl: string | null;
  disabled: boolean;
  onRecordingReady: (path: string, url: string) => void;
}

type RecState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

export function Recorder({ serverUrl, disabled, onRecordingReady }: Props) {
  const [state, setState] = useState<RecState>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (state.kind !== "recording") return;
    const startedAt = state.startedAt;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    if (!serverUrl) return;
    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await upload(blob, mr.mimeType);
      };
      mr.onerror = (e) => {
        setState({
          kind: "error",
          message: `recorder error: ${(e as any).error?.message ?? "unknown"}`,
        });
      };

      mr.start(250);
      setState({ kind: "recording", startedAt: Date.now() });
      setElapsed(0);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const stop = () => recorderRef.current?.stop();

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

  if (state.kind === "idle") {
    return (
      <button
        onClick={start}
        disabled={disabled || !serverUrl}
        className="btn record"
        title="Record from microphone"
      >
        <Mic size={16} />
        <span>Record</span>
      </button>
    );
  }

  if (state.kind === "requesting") {
    return (
      <div className="rec-status">
        <Loader2 size={14} className="spin" /> <span>Requesting microphone…</span>
      </div>
    );
  }

  if (state.kind === "recording") {
    return (
      <div className="rec-active">
        <button onClick={stop} className="btn record-stop">
          <Square size={14} fill="currentColor" />
          <span>Stop</span>
        </button>
        <span className="rec-time">
          <span className="rec-pulse" />
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
      <span title={state.message}>Mic error: {state.message}</span>
      <button onClick={dismissError} className="rec-dismiss" title="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

function pickMimeType(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return null;
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
