import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Loader2, AlertCircle, Download } from "lucide-react";
import {
  api,
  on,
  type CatalogModel,
  type GpuInfo,
  type LanguageOption,
  type ModelDownloadEvent,
  type ModelLoadStatusEvent,
  type Segment,
  type TranscribeStatusEvent,
} from "./api";
import { AudioBar } from "./AudioBar";
import { ModelManager } from "./ModelManager";
import { Sidebar } from "./Sidebar";
import { Transcript } from "./Transcript";

type AppStatus =
  | { kind: "checking" }
  | { kind: "model_missing" }
  | { kind: "downloading"; bytes: number }
  | { kind: "ready" }
  | { kind: "loading_model" }
  | { kind: "transcribing" }
  | { kind: "done"; duration: number }
  | { kind: "error"; message: string };

export function App() {
  const [status, setStatus] = useState<AppStatus>({ kind: "checking" });
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ path: string; url: string } | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>("ivrit-ai/whisper-large-v3-ct2");
  const [activeLanguage, setActiveLanguage] = useState<string>("he");
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [currentLoadedId, setCurrentLoadedId] = useState<string | null>(null);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);

  // The AudioBar registers a seek fn we can call from the Transcript.
  const seekRef = useRef<((t: number) => void) | null>(null);
  const registerSeek = useCallback((fn: ((t: number) => void) | null) => {
    seekRef.current = fn;
  }, []);

  const refreshModels = useCallback(async () => {
    const list = await api.listModels();
    setModels(list);
  }, []);

  useEffect(() => {
    api.checkModel().then((r) => {
      setGpu(r.gpu);
      setActiveModelId(r.active_model_id);
      setActiveLanguage(r.active_language);
      setCurrentLoadedId(r.current_model_id);
      setStatus(r.present ? { kind: "ready" } : { kind: "model_missing" });
    });
    api.getServerUrl().then(setServerUrl);
    api.getLanguages().then(setLanguages);
    void refreshModels();

    const offDl = on("model_download", (p: ModelDownloadEvent) => {
      // Default-flow boot card only reacts to events for the active model.
      if (p.status === "downloading") setStatus({ kind: "downloading", bytes: p.bytes });
      else if (p.status === "complete") {
        setStatus({ kind: "ready" });
        void refreshModels();
      } else if (p.status === "error") setStatus({ kind: "error", message: p.error });
    });
    const offMl = on("model_load_status", (p: ModelLoadStatusEvent) => {
      if (p.status === "loaded") setCurrentLoadedId(p.model_id);
      void refreshModels();
    });
    const offSeg = on("segment", (s: Segment) => {
      setSegments((prev) => [...prev, s]);
    });
    const offTr = on("transcribe_status", (p: TranscribeStatusEvent) => {
      if (p.status === "loading_model") {
        setStatus({ kind: "loading_model" });
        if (p.model_id) setCurrentLoadedId(p.model_id);
      } else if (p.status === "transcribing") setStatus({ kind: "transcribing" });
      else if (p.status === "language_detected") setDetectedLanguage(p.language);
      else if (p.status === "done") {
        setStatus({ kind: "done", duration: p.duration });
        if (p.language) setDetectedLanguage(p.language);
        if (p.model_id) setCurrentLoadedId(p.model_id);
      }
      else if (p.status === "error") setStatus({ kind: "error", message: p.error });
    });
    return () => {
      offDl(); offMl(); offSeg(); offTr();
    };
  }, [refreshModels]);

  const startTranscribe = (path: string, url: string) => {
    setAudio({ path, url });
    setSegments([]);
    setCurrentTime(0);
    setDetectedLanguage(null);
    setStatus({ kind: "transcribing" });
    void api.transcribe(path, {
      temperature,
      model_id: activeModelId,
      language: activeLanguage,
    });
  };

  const handlePick = async () => {
    const file = await api.pickAudio();
    if (!file) return;
    startTranscribe(file.path, file.url);
  };

  const handleRecordingReady = (path: string, url: string) => {
    startTranscribe(path, url);
  };

  const handleRetranscribe = () => {
    if (!audio) return;
    setSegments([]);
    setDetectedLanguage(null);
    setStatus({ kind: "transcribing" });
    void api.transcribe(audio.path, {
      temperature,
      model_id: activeModelId,
      language: activeLanguage,
    });
  };

  const handleModelChange = async (modelId: string) => {
    setActiveModelId(modelId);
    await api.setActiveModel(modelId);
    void refreshModels();
  };

  const handleLanguageChange = async (lang: string) => {
    setActiveLanguage(lang);
    await api.setActiveLanguage(lang);
  };

  const handleSeek = (t: number) => {
    seekRef.current?.(t);
  };

  const busy =
    status.kind === "transcribing" ||
    status.kind === "loading_model" ||
    status.kind === "downloading";

  // Special pre-ready UI: model needs downloading
  if (status.kind === "model_missing" || status.kind === "downloading") {
    return (
      <div className="boot">
        <div className="boot-card">
          <h2>One-time setup</h2>
          {status.kind === "model_missing" ? (
            <>
              <p>
                The Hebrew Whisper model (<code>ivrit-ai/whisper-large-v3-ct2</code>, ~3 GB)
                needs to be downloaded. Stored once in your HuggingFace cache.
              </p>
              <button className="btn primary" onClick={() => api.downloadModel()}>
                <Download size={16} />
                <span>Download model</span>
              </button>
            </>
          ) : (
            <>
              <p>Downloading model — {fmtBytes(status.bytes)} of ~3 GB.</p>
              <ProgressBar value={status.bytes} max={3_100_000_000} />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">SpeakToSpeech</span>
        </div>
        <div className="header-status">
          <GpuBadge gpu={gpu} />
          <StatusBadge status={status} segments={segments.length} />
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          audioPath={audio?.path ?? null}
          serverUrl={serverUrl}
          busy={busy}
          temperature={temperature}
          segments={segments}
          models={models}
          languages={languages}
          activeModelId={activeModelId}
          activeLanguage={activeLanguage}
          detectedLanguage={detectedLanguage}
          onTemperatureChange={setTemperature}
          onPick={handlePick}
          onRecordingReady={handleRecordingReady}
          onRetranscribe={handleRetranscribe}
          onLanguageChange={handleLanguageChange}
          onModelChange={handleModelChange}
          onOpenModelManager={() => setModelManagerOpen(true)}
        />

        {modelManagerOpen && (
          <ModelManager
            models={models}
            activeModelId={activeModelId}
            currentLoadedId={currentLoadedId}
            busy={busy}
            onClose={() => setModelManagerOpen(false)}
            onActivate={(id) => {
              void handleModelChange(id);
            }}
            onRefresh={() => void refreshModels()}
          />
        )}

        <main className="main">
          <AudioBar
            url={audio?.url ?? null}
            segments={segments}
            currentTime={currentTime}
            onTimeChange={setCurrentTime}
            registerSeek={registerSeek}
          />
          <Transcript
            segments={segments}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        </main>
      </div>
    </div>
  );
}

function StatusBadge({ status, segments }: { status: AppStatus; segments: number }) {
  const map = {
    checking: { label: "Checking…", icon: <Loader2 size={12} className="spin" /> },
    model_missing: { label: "Model missing", icon: <AlertCircle size={12} /> },
    downloading: { label: "Downloading", icon: <Loader2 size={12} className="spin" /> },
    ready: { label: "Ready", icon: <CheckCircle2 size={12} /> },
    loading_model: { label: "Loading model", icon: <Loader2 size={12} className="spin" /> },
    transcribing: {
      label: `Transcribing · ${segments} seg`,
      icon: <Loader2 size={12} className="spin" />,
    },
    done: { label: `Done · ${segments} seg`, icon: <CheckCircle2 size={12} /> },
    error: { label: "Error", icon: <AlertCircle size={12} /> },
  } as const;
  const m = map[status.kind];
  return (
    <span className={`badge badge-${status.kind}`} title={status.kind === "error" ? status.message : ""}>
      {m.icon}
      <span>{m.label}</span>
    </span>
  );
}

function GpuBadge({ gpu }: { gpu: GpuInfo | null }) {
  if (!gpu) return null;
  const ok = gpu.cuda_available;
  return (
    <span
      className={`badge ${ok ? "badge-ready" : "badge-error"}`}
      title={gpu.error ?? ""}
    >
      <Cpu size={12} />
      <span>{ok ? `CUDA × ${gpu.device_count}` : "No CUDA"}</span>
    </span>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
