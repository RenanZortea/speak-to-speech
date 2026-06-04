import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Loader2,
  AlertCircle,
  Download,
} from "lucide-react";
import {
  api,
  on,
  type CatalogModel,
  type GpuInfo,
  type LanguageOption,
  type ModelDownloadEvent,
  type ModelLoadStatusEvent,
  type Phoneme,
  type PronStatusEvent,
  type ResourceStats,
  type Segment,
  type SessionSummary,
  type TranscribeStatusEvent,
  type UpdateInfo,
} from "./api";
import { alignPhonemes } from "./alignment";
import { AudioBar } from "./AudioBar";
import { CodeTranscript } from "./CodeTranscript";
import { ModelManager } from "./ModelManager";
import { PronunciationBar } from "./PronunciationBar";
import { ResourceFooter } from "./ResourceFooter";
import { SessionsRail } from "./SessionsRail";
import { SettingsModal } from "./SettingsModal";
import { Sidebar } from "./Sidebar";

type PronStatus =
  | "idle"
  | "loading_model"
  | "converting"
  | "analyzing"
  | "done"
  | "error";

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

  // Pronunciation state — lifted here so it survives tab switches and so the
  // pron_status "done" event isn't missed while the Pronunciation tab is hidden.
  const [pronModelPresent, setPronModelPresent] = useState<boolean | null>(null);
  const [pronDownloadBytes, setPronDownloadBytes] = useState<number | null>(null);
  const [pronStatus, setPronStatus] =
    useState<PronStatus>("idle");
  const [pronPhonemes, setPronPhonemes] = useState<Phoneme[]>([]);
  const [pronMeanConf, setPronMeanConf] = useState<number>(0);
  const [pronError, setPronError] = useState<string | null>(null);
  const [jobState, setJobState] = useState<{ busy: boolean; job: string | null }>({
    busy: false,
    job: null,
  });

  // Sessions (persistence)
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);

  // Resources
  const [resourceStats, setResourceStats] = useState<ResourceStats | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Updates
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{ bytes: number; total: number } | null>(null);

  // The AudioBar registers a seek fn we can call from the Transcript.
  const seekRef = useRef<((t: number) => void) | null>(null);
  const registerSeek = useCallback((fn: ((t: number) => void) | null) => {
    seekRef.current = fn;
  }, []);

  const refreshModels = useCallback(async () => {
    const list = await api.listModels();
    setModels(list);
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await api.listSessions());
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
    api.checkPronModel().then((r) => setPronModelPresent(r.present));
    void refreshModels();
    void refreshSessions();

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
        setAudioDuration(p.duration);
        setHasUnsaved(true);
        if (p.language) setDetectedLanguage(p.language);
        if (p.model_id) setCurrentLoadedId(p.model_id);
      }
      else if (p.status === "error") setStatus({ kind: "error", message: p.error });
    });

    const offPronDl = on("pron_model_download", (p: ModelDownloadEvent) => {
      if (p.status === "downloading") setPronDownloadBytes(p.bytes);
      else if (p.status === "complete") {
        setPronModelPresent(true);
        setPronDownloadBytes(null);
      } else if (p.status === "cancelled") {
        setPronDownloadBytes(null);
      } else if (p.status === "error") {
        setPronDownloadBytes(null);
        setPronError(p.error);
      }
    });
    const offPron = on("pron_status", (p: PronStatusEvent) => {
      if (p.status === "done") {
        setPronPhonemes(p.phonemes);
        setPronMeanConf(p.mean_confidence);
        setPronStatus("done");
        setHasUnsaved(true);
      } else if (p.status === "error") {
        setPronStatus("error");
        setPronError(p.error);
      } else {
        setPronStatus(p.status); // loading_model | converting | analyzing
      }
    });
    const offJob = on("job_state", (p: { busy: boolean; job: string | null }) => {
      setJobState(p);
    });
    const offRes = on("resource_stats", (s: ResourceStats) => {
      setResourceStats(s);
    });
    const offUpd = on("update_download", (p: any) => {
      if (p.status === "error" || p.status === "launching" || p.status === "manual") {
        setUpdateProgress(null);
      } else if (typeof p.bytes === "number") {
        setUpdateProgress({ bytes: p.bytes, total: p.total ?? 0 });
      }
    });

    // Check for updates on startup (non-blocking; ignores failures silently).
    api.checkForUpdate().then((info) => {
      if (info.update_available) setUpdateInfo(info);
    });

    return () => {
      offDl(); offMl(); offSeg(); offTr(); offPronDl(); offPron(); offJob(); offRes(); offUpd();
    };
  }, [refreshModels, refreshSessions]);

  const startTranscribe = (path: string, url: string) => {
    setAudio({ path, url });
    setSegments([]);
    setCurrentTime(0);
    setDetectedLanguage(null);
    // New audio invalidates any prior pronunciation analysis and the active session.
    setPronPhonemes([]);
    setPronStatus("idle");
    setPronError(null);
    setActiveSessionId(null);
    setHasUnsaved(true);
    setStatus({ kind: "transcribing" });
    void api.transcribe(path, {
      temperature,
      model_id: activeModelId,
      language: activeLanguage,
    });
  };

  const handleAnalyzePronunciation = () => {
    if (!audio) return;
    setPronPhonemes([]);
    setPronError(null);
    setPronStatus("loading_model");
    void api.assessPronunciation(audio.path);
  };

  const handleDownloadPronModel = () => {
    setPronError(null);
    void api.downloadPronModel();
  };

  const handleCancelPronDownload = () => {
    void api.cancelPronDownload();
  };

  // ---- Sessions ----

  const canSaveSession = !!audio && segments.length > 0;

  const handleSaveSession = async () => {
    if (!audio || segments.length === 0) return;
    const pronunciation =
      pronStatus === "done" && pronPhonemes.length > 0
        ? { phonemes: pronPhonemes, mean_confidence: pronMeanConf }
        : null;
    const data = {
      title: deriveTitle(segments),
      audio_path: audio.path,
      language: activeLanguage,
      model_id: activeModelId,
      duration: audioDuration || undefined,
      segments,
      pronunciation,
    };
    if (activeSessionId) {
      await api.updateSession(activeSessionId, data);
    } else {
      const summary = await api.saveSession(data);
      setActiveSessionId(summary.id);
    }
    setHasUnsaved(false);
    void refreshSessions();
  };

  const handleLoadSession = async (id: string) => {
    const sess = await api.loadSession(id);
    if (!sess) return;
    setActiveSessionId(sess.id);
    setSegments(sess.segments);
    setAudioDuration(sess.duration ?? 0);
    setCurrentTime(0);
    if (sess.audio_url) {
      setAudio({ path: sess.audio_stored_path ?? "", url: sess.audio_url });
    }
    if (sess.pronunciation && sess.pronunciation.phonemes.length > 0) {
      setPronPhonemes(sess.pronunciation.phonemes);
      setPronMeanConf(sess.pronunciation.mean_confidence);
      setPronStatus("done");
    } else {
      setPronPhonemes([]);
      setPronStatus("idle");
    }
    if (sess.language) setActiveLanguage(sess.language);
    if (sess.model_id) setActiveModelId(sess.model_id);
    setStatus({ kind: "done", duration: sess.duration ?? 0 });
    setHasUnsaved(false);
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    if (activeSessionId === id) setActiveSessionId(null);
    void refreshSessions();
  };

  const handleRenameSession = async (id: string, title: string) => {
    await api.renameSession(id, title);
    void refreshSessions();
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

  // Pair phonemes with words once both exist. Floating phonemes stay unassigned.
  const alignment = useMemo(() => {
    if (pronStatus !== "done" || pronPhonemes.length === 0) return null;
    return alignPhonemes(segments, pronPhonemes);
  }, [pronStatus, pronPhonemes, segments]);

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
          {jobState.busy && jobState.job === "pronunciation" && (
            <span className="badge badge-transcribing">
              <Loader2 size={12} className="spin" />
              <span>Analyzing</span>
            </span>
          )}
          <GpuBadge gpu={gpu} />
          <StatusBadge status={status} segments={segments.length} />
        </div>
      </header>

      <div className="app-body">
        <SessionsRail
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((c) => !c)}
          sessions={sessions}
          activeSessionId={activeSessionId}
          hasUnsaved={hasUnsaved}
          canSave={canSaveSession}
          onSave={handleSaveSession}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          onRename={handleRenameSession}
        />

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

          <PronunciationBar
            hasAudio={!!audio}
            modelPresent={pronModelPresent}
            downloadBytes={pronDownloadBytes}
            status={pronStatus}
            phonemes={pronPhonemes}
            meanConfidence={pronMeanConf}
            floatingCount={alignment?.floating.length ?? 0}
            error={pronError}
            onAnalyze={handleAnalyzePronunciation}
            onDownload={handleDownloadPronModel}
            onCancelDownload={handleCancelPronDownload}
          />

          <CodeTranscript
            segments={segments}
            alignment={alignment}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        </main>
      </div>

      <ResourceFooter
        stats={resourceStats}
        onOpenSettings={() => setSettingsOpen(true)}
        updateAvailable={!!updateInfo?.update_available && !updateDismissed}
        onUpdateClick={() => setSettingsOpen(true)}
        onUpdateDismiss={() => setUpdateDismissed(true)}
      />

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          updateInfo={updateInfo}
          updateProgress={updateProgress}
          onCheckUpdate={async () => {
            const info = await api.checkForUpdate();
            setUpdateInfo(info);
            setUpdateDismissed(false);
            return info;
          }}
          onInstall={(url) => {
            setUpdateProgress({ bytes: 0, total: 0 });
            void api.installUpdate(url);
          }}
        />
      )}
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

function deriveTitle(segments: Segment[]): string {
  const text = segments
    .map((s) => s.text.trim())
    .join(" ")
    .trim();
  if (!text) return `Session ${new Date().toLocaleDateString()}`;
  const words = text.split(/\s+/).slice(0, 6).join(" ");
  return words.length > 48 ? words.slice(0, 48) + "…" : words;
}
