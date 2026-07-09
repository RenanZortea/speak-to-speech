import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Loader2,
  AlertCircle,
  Download,
  X,
} from "lucide-react";
import {
  api,
  on,
  type AccentModelInfo,
  type AccentResult,
  type CatalogModel,
  type GpuInfo,
  type LanguageOption,
  type ModelDownloadEvent,
  type ModelLoadStatusEvent,
  type Phoneme,
  type PronStatusEvent,
  type ResourceStats,
  type OllamaStatusEvent,
  type Segment,
  type SessionSummary,
  type TranscribeStatusEvent,
  type UpdateInfo,
} from "./api";
import { alignPhonemes } from "./alignment";
import {
  buildCorrectionPrompt,
  mapAiCorrections,
  parseAiJson,
  type AiGenState,
} from "./aiCorrect";
import { type Correction, correctedSentenceAt, newCorrectionId } from "./corrections";
import { buildTranscriptDoc } from "./transcriptDoc";
import { AccentBar, type AccentStatus } from "./AccentBar";
import { AudioBar } from "./AudioBar";
import { CodeTranscript, type CorrectionView } from "./CodeTranscript";
import { CorrectionDialog, type DialogTarget } from "./CorrectionDialog";
import { CorrectionMenu, type MenuTarget } from "./CorrectionMenu";
import { CorrectAiModal } from "./CorrectAiModal";
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
  | { kind: "low_memory_retry" }
  | { kind: "done"; duration: number }
  | { kind: "error"; message: string };

export function App() {
  const [status, setStatus] = useState<AppStatus>({ kind: "checking" });
  const [modelNoticeDismissed, setModelNoticeDismissed] = useState(false);
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

  // Accent state — on-demand, language-gated (mirrors pronunciation state above).
  const [accentModels, setAccentModels] = useState<AccentModelInfo[]>([]);
  const [accentStatus, setAccentStatus] = useState<AccentStatus>("idle");
  const [accentResult, setAccentResult] = useState<AccentResult | null>(null);
  const [accentError, setAccentError] = useState<string | null>(null);
  const [accentDownloadBytes, setAccentDownloadBytes] = useState<number | null>(null);

  // Sessions (persistence)
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);

  // Resources
  const [resourceStats, setResourceStats] = useState<ResourceStats | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Corrections (manual)
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [correctionView, setCorrectionView] = useState<CorrectionView>("corrected");
  const [seekInCorrected, setSeekInCorrected] = useState<boolean>(
    () => localStorage.getItem("seekInCorrected") !== "false",
  );
  const [ctxMenu, setCtxMenu] = useState<MenuTarget | null>(null);
  const [corrDialog, setCorrDialog] = useState<DialogTarget | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // Ollama generation lives at app level so it keeps running (and still applies
  // its corrections) even if the user closes the "Correct with AI" window.
  const [aiGen, setAiGen] = useState<AiGenState>({ status: "idle" });
  // Current segments for the (mount-time) ollama_status handler closure.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

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

  // Re-surface the dismissible notice whenever the model goes missing again
  // (fresh launch, or deleted mid-session) — dismissal is per-occurrence, not permanent.
  useEffect(() => {
    if (status.kind === "model_missing") setModelNoticeDismissed(false);
  }, [status.kind]);

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
    void api.listAccentModels().then(setAccentModels);
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
      else if (p.status === "low_memory_retry") setStatus({ kind: "low_memory_retry" });
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
    const offAccent = on("accent_status", (p: any) => {
      if (p.status === "done") {
        setAccentResult(p as AccentResult);
        setAccentStatus("done");
      } else if (p.status === "error") {
        setAccentError(p.error);
        setAccentStatus("error");
      } else {
        setAccentStatus(p.status);
      }
    });
    const offAccentDl = on("accent_model_download", (p: any) => {
      if (p.status === "downloading") setAccentDownloadBytes(p.bytes);
      else {
        setAccentDownloadBytes(null);
        if (p.status === "complete") void api.listAccentModels().then(setAccentModels);
      }
    });
    const offJob = on("job_state", (p: { busy: boolean; job: string | null }) => {
      setJobState(p);
    });
    const offRes = on("resource_stats", (s: ResourceStats) => {
      setResourceStats(s);
    });
    const offAi = on("ollama_status", (e: OllamaStatusEvent) => {
      if (e.status === "generating") {
        setAiGen({ status: "generating", model: e.model });
      } else if (e.status === "done") {
        try {
          const json = parseAiJson(e.text);
          const { corrections, unplaced } = mapAiCorrections(json, segmentsRef.current);
          if (corrections.length > 0) {
            setCorrections((cs) => [...cs, ...corrections]);
            setHasUnsaved(true);
          }
          setAiGen({
            status: "done",
            output: e.text,
            result: { added: corrections.length, unplaced },
          });
        } catch (err) {
          setAiGen({ status: "error", error: (err as Error).message });
        }
      } else if (e.status === "error") {
        setAiGen({ status: "error", error: e.error });
      }
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
      offDl(); offMl(); offSeg(); offTr(); offPronDl(); offPron(); offAccent(); offAccentDl();
      offJob(); offRes(); offUpd(); offAi();
    };
  }, [refreshModels, refreshSessions]);

  const startTranscribe = (path: string, url: string) => {
    setAudio({ path, url });
    setSegments([]);
    setCurrentTime(0);
    setDetectedLanguage(null);
    // New audio invalidates any prior pronunciation/accent analysis, corrections, session.
    setPronPhonemes([]);
    setPronStatus("idle");
    setPronError(null);
    setAccentResult(null);
    setAccentStatus("idle");
    setAccentError(null);
    setCorrections([]);
    setAiGen({ status: "idle" });
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

  const accentModel = accentModels.find((m) => m.language === activeLanguage) ?? null;

  const handleAnalyzeAccent = () => {
    if (!audio || !accentModel) return;
    setAccentError(null);
    setAccentStatus("loading_model");
    void api.analyzeAccent(audio.path, activeLanguage);
  };
  const handleDownloadAccent = () => {
    if (!accentModel) return;
    void api.downloadAccentModel(accentModel.id);
  };
  const handleCancelAccentDownload = () => {
    if (!accentModel) return;
    void api.cancelAccentDownload(accentModel.id);
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
      corrections,
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
    setAccentResult(null);
    setAccentStatus("idle");
    setAccentError(null);
    setCorrections(sess.corrections ?? []);
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

  // ---- Corrections ----
  const handleRequestContextMenu = (t: MenuTarget) => setCtxMenu(t);
  const saveCorrection = (data: {
    suggestion: string;
    category: Correction["category"];
    explanation: string;
  }) => {
    if (!corrDialog) return;
    if (corrDialog.existing) {
      const id = corrDialog.existing.id;
      setCorrections((cs) => cs.map((c) => (c.id === id ? { ...c, ...data } : c)));
    } else {
      const c: Correction = {
        id: newCorrectionId(),
        from: corrDialog.from,
        to: corrDialog.to,
        original: corrDialog.original,
        source: "manual",
        ...data,
      };
      setCorrections((cs) => [...cs, c]);
    }
    setHasUnsaved(true);
    setCorrDialog(null);
  };
  const deleteCorrectionFromDialog = () => {
    if (corrDialog?.existing) {
      const id = corrDialog.existing.id;
      setCorrections((cs) => cs.filter((c) => c.id !== id));
      setHasUnsaved(true);
    }
    setCorrDialog(null);
  };
  const applyAiCorrections = (newCorrs: Correction[]) => {
    if (newCorrs.length === 0) return;
    setCorrections((cs) => [...cs, ...newCorrs]);
    setHasUnsaved(true);
  };

  const activeLanguageName =
    languages.find((l) => l.code === activeLanguage)?.name ?? activeLanguage;

  const startOllamaCorrect = (model: string) => {
    setAiGen({ status: "generating", model });
    void api.ollamaCorrect(buildCorrectionPrompt(segments, activeLanguageName), model);
  };

  const busy =
    status.kind === "transcribing" ||
    status.kind === "loading_model" ||
    status.kind === "downloading";

  const showModelNotice =
    (status.kind === "model_missing" || status.kind === "downloading") && !modelNoticeDismissed;

  return (
    <div className="app">
      {showModelNotice && (
        <div className="model-notice">
          <button
            className="model-notice-close"
            onClick={() => setModelNoticeDismissed(true)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
          {status.kind === "model_missing" ? (
            <>
              <h3>Model needed</h3>
              <p>
                The Hebrew Whisper model (<code>ivrit-ai/whisper-large-v3-ct2</code>, ~3 GB)
                isn't downloaded yet.
              </p>
              <div className="model-notice-actions">
                <button className="btn primary" onClick={() => api.downloadModel()}>
                  <Download size={14} />
                  <span>Download</span>
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setModelManagerOpen(true);
                    setModelNoticeDismissed(true);
                  }}
                >
                  <span>Choose a model…</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>Downloading model…</h3>
              <p>{fmtBytes(status.bytes)} of ~3 GB</p>
              <ProgressBar value={status.bytes} max={3_100_000_000} />
            </>
          )}
        </div>
      )}

      {status.kind === "error" && (
        <div className="model-notice error-notice">
          <button
            className="model-notice-close"
            onClick={() => setStatus({ kind: audio ? "done" : "ready", duration: audioDuration } as AppStatus)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
          <h3>Transcription failed</h3>
          <p className="error-notice-msg">{status.message}</p>
          <div className="model-notice-actions">
            {audio && (
              <button className="btn primary" onClick={handleRetranscribe} disabled={busy}>
                <span>Retry</span>
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                setModelManagerOpen(true);
              }}
            >
              <span>Manage models…</span>
            </button>
          </div>
        </div>
      )}

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
          corrections={corrections}
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
          onOpenAiCorrect={() => setAiModalOpen(true)}
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
            hasCorrections={corrections.length > 0}
            correctionView={correctionView}
            onCorrectionViewChange={setCorrectionView}
            onAnalyze={handleAnalyzePronunciation}
            onDownload={handleDownloadPronModel}
            onCancelDownload={handleCancelPronDownload}
          />

          <AccentBar
            hasAudio={!!audio}
            supported={!!accentModel}
            modelPresent={accentModel ? accentModel.present : null}
            downloadBytes={accentDownloadBytes}
            status={accentStatus}
            result={accentResult}
            error={accentError}
            onAnalyze={handleAnalyzeAccent}
            onDownload={handleDownloadAccent}
            onCancelDownload={handleCancelAccentDownload}
          />

          <CodeTranscript
            segments={segments}
            alignment={alignment}
            corrections={corrections}
            view={correctionView}
            seekInCorrected={seekInCorrected}
            currentTime={currentTime}
            onSeek={handleSeek}
            onRequestContextMenu={handleRequestContextMenu}
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

      {ctxMenu && (
        <CorrectionMenu
          target={ctxMenu}
          onAdd={() => {
            setCorrDialog({
              from: ctxMenu.from,
              to: ctxMenu.to,
              original: ctxMenu.original,
              existing: null,
            });
            setCtxMenu(null);
          }}
          onEdit={() => {
            const c = corrections.find((c) => c.id === ctxMenu.existingId);
            if (c) setCorrDialog({ from: c.from, to: c.to, original: c.original, existing: c });
            setCtxMenu(null);
          }}
          onDelete={() => {
            setCorrections((cs) => cs.filter((c) => c.id !== ctxMenu.existingId));
            setHasUnsaved(true);
            setCtxMenu(null);
          }}
          onCopyWord={() => {
            const c = corrections.find((c) => c.id === ctxMenu.existingId);
            if (c) void navigator.clipboard.writeText(c.suggestion);
            setCtxMenu(null);
          }}
          onCopy={() => {
            const { text } = buildTranscriptDoc(segments);
            const sentence = correctedSentenceAt(text, corrections, ctxMenu.from, ctxMenu.to);
            void navigator.clipboard.writeText(sentence);
            setCtxMenu(null);
          }}
          onPlay={() => {
            if (ctxMenu.time !== null) handleSeek(ctxMenu.time);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {corrDialog && (
        <CorrectionDialog
          target={corrDialog}
          onSave={saveCorrection}
          onDelete={deleteCorrectionFromDialog}
          onClose={() => setCorrDialog(null)}
        />
      )}

      {aiModalOpen && (
        <CorrectAiModal
          segments={segments}
          languageName={activeLanguageName}
          onApply={applyAiCorrections}
          onClose={() => setAiModalOpen(false)}
          ollamaGen={aiGen}
          onOllamaGenerate={startOllamaCorrect}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          seekInCorrected={seekInCorrected}
          onSeekInCorrectedChange={(v) => {
            setSeekInCorrected(v);
            localStorage.setItem("seekInCorrected", String(v));
          }}
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
    low_memory_retry: {
      label: "Low VRAM · retrying leaner",
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
