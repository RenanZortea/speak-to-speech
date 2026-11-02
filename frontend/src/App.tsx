import { useWorkspaceState } from "./useWorkspaceState";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Loader2,
  RotateCcw,
  AlertCircle,
  Download,
  X,
} from "lucide-react";
import {
  api,
  on,
  type CatalogModel,
  type GpuInfo,
  type LanguageOption,
  type ModelDownloadEvent,
  type ModelLoadStatusEvent,
  type ResourceStats,
  type OllamaStatusEvent,
  type Segment,
  type SessionSummary,
  type TranscribeStatusEvent,
  type UpdateInfo,
} from "./api";
import {
  buildCorrectionPrompt,
  mapAiCorrections,
  parseAiJson,
  type AiGenState,
} from "./aiCorrect";
import { type Correction, correctedSentenceAt, newCorrectionId } from "./corrections";
import { buildTranscriptDoc } from "./transcriptDoc";
import { LyricsTranscript } from "./LyricsTranscript";
import { AudioBar } from "./AudioBar";
import { CodeTranscript, type CorrectionView } from "./CodeTranscript";
import { CorrectionDialog, type DialogTarget } from "./CorrectionDialog";
import { CorrectionMenu, type MenuTarget } from "./CorrectionMenu";
import { CorrectAiModal } from "./CorrectAiModal";
import { ModelManager } from "./ModelManager";
import { ResourceFooter } from "./ResourceFooter";
import { SessionsRail } from "./SessionsRail";
import { SettingsModal } from "./SettingsModal";
import { WorkspaceToolbar } from "./Sidebar";
import { VowelStudio } from "./VowelStudio";
import { Recorder, useRecorder } from "./Recorder";
import { MediaWidget } from "./MediaWidget";
import type { TrackedFormants } from "./formantTracker";

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
  const [mainView, setMainView] = useState<"transcript" | "vowels" | "youtube">("transcript");
  const workspace = mainView === "youtube" ? "youtube" : "main";
  const [transcriptionRequest, setTranscriptionRequest] = useWorkspaceState(workspace, 0);
  const [transcriptDisplay, setTranscriptDisplay] = useWorkspaceState<"lyrics" | "edit">(workspace, "lyrics");
  const [status, setStatus] = useState<AppStatus>({ kind: "checking" });
  const [modelNoticeDismissed, setModelNoticeDismissed] = useState(false);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [audio, setAudio] = useWorkspaceState<{ path: string; url: string; loadId: number } | null>(workspace, null);
  const audioLoadIdRef = useRef(0);
  const [segments, setSegments] = useWorkspaceState<Segment[]>(workspace, []);
  const [currentTime, setCurrentTime] = useWorkspaceState(workspace, 0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [playbackFormants, setPlaybackFormants] = useState<TrackedFormants | null>(null);
  const mainViewRef = useRef(mainView);
  mainViewRef.current = mainView;
  const [temperature, setTemperature] = useState(0);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [activeModelId, setActiveModelId] = useState<string>("ivrit-ai/whisper-large-v3-ct2");
  const [activeLanguage, setActiveLanguage] = useState<string>("he");
  const [detectedLanguage, setDetectedLanguage] = useWorkspaceState<string | null>(workspace, null);
  const [currentLoadedId, setCurrentLoadedId] = useState<string | null>(null);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);

  // Sessions (persistence)
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useWorkspaceState<string | null>(workspace, null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [hasUnsaved, setHasUnsaved] = useWorkspaceState(workspace, false);
  const [audioDuration, setAudioDuration] = useWorkspaceState(workspace, 0);

  const [autoSaveAudio, setAutoSaveAudio] = useState(() => localStorage.getItem("autoSaveAudio") === "true");
  const [savingSession, setSavingSession] = useState(false);
  const savingSessionRef = useRef(false);

  // Resources
  const [resourceStats, setResourceStats] = useState<ResourceStats | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Corrections (manual)
  const [corrections, setCorrections] = useWorkspaceState<Correction[]>(workspace, []);
  const [correctionView, setCorrectionView] = useWorkspaceState<CorrectionView>(workspace, "corrected");
  const [seekInCorrected, setSeekInCorrected] = useState<boolean>(
    () => localStorage.getItem("seekInCorrected") !== "false",
  );
  const [ctxMenu, setCtxMenu] = useState<MenuTarget | null>(null);
  const [corrDialog, setCorrDialog] = useState<DialogTarget | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // Ollama generation lives at app level so it keeps running (and still applies
  // its corrections) even if the user closes the "Correct with AI" window.
  const [aiGen, setAiGen] = useWorkspaceState<AiGenState>(workspace, { status: "idle" });
  // Current segments for the (mount-time) ollama_status handler closure.
  const transcriptionTarget = useRef({ setSegments, setDetectedLanguage, setAudioDuration, setHasUnsaved });
  const aiTarget = useRef({ segments, setAiGen, setCorrections, setHasUnsaved });
  const [jobWorkspace, setJobWorkspace] = useState<"main" | "youtube" | null>(null);

  // Updates
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{ bytes: number; total: number } | null>(null);

  // The AudioBar registers a seek fn we can call from the Transcript.
  const seekRef = useRef<((t: number) => void) | null>(null);
  const registerSeek = useCallback((fn: ((t: number) => void) | null) => {
    seekRef.current = fn;
  }, []);
  const handlePlaybackFormants = useCallback((formants: TrackedFormants | null) => {
    // LPC updates are frequent; don't rerender the transcript while audio plays.
    if (mainViewRef.current === "vowels" || formants === null) setPlaybackFormants(formants);
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
      transcriptionTarget.current.setSegments((prev) => [...prev, s]);
    });
    const offTr = on("transcribe_status", (p: TranscribeStatusEvent) => {
      if (p.status === "loading_model") {
        setStatus({ kind: "loading_model" });
        if (p.model_id) setCurrentLoadedId(p.model_id);
      } else if (p.status === "transcribing") setStatus({ kind: "transcribing" });
      else if (p.status === "low_memory_retry") setStatus({ kind: "low_memory_retry" });
      else if (p.status === "language_detected") transcriptionTarget.current.setDetectedLanguage(p.language);
      else if (p.status === "done") {
        setStatus({ kind: "done", duration: p.duration });
        transcriptionTarget.current.setAudioDuration(p.duration);
        transcriptionTarget.current.setHasUnsaved(true);
        if (p.language) transcriptionTarget.current.setDetectedLanguage(p.language);
        if (p.model_id) setCurrentLoadedId(p.model_id);
      }
      else if (p.status === "error") setStatus({ kind: "error", message: p.error });
    });

    const offRes = on("resource_stats", (s: ResourceStats) => {
      setResourceStats(s);
    });
    const offAi = on("ollama_status", (e: OllamaStatusEvent) => {
      if (e.status === "generating") {
        aiTarget.current.setAiGen({ status: "generating", model: e.model });
      } else if (e.status === "done") {
        try {
          const json = parseAiJson(e.text);
          const { corrections, unplaced } = mapAiCorrections(json, aiTarget.current.segments);
          if (corrections.length > 0) {
            aiTarget.current.setCorrections((cs) => [...cs, ...corrections]);
            aiTarget.current.setHasUnsaved(true);
          }
          aiTarget.current.setAiGen({
            status: "done",
            output: e.text,
            result: { added: corrections.length, unplaced },
          });
        } catch (err) {
          aiTarget.current.setAiGen({ status: "error", error: (err as Error).message });
        }
      } else if (e.status === "error") {
        aiTarget.current.setAiGen({ status: "error", error: e.error });
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
      offDl(); offMl(); offSeg(); offTr(); offRes(); offUpd(); offAi();
    };
  }, [refreshModels, refreshSessions]);

  const prepareAudio = (path: string, url: string) => {
    setTranscriptionRequest(0);
    setTranscriptDisplay("lyrics");
    setCorrectionView("corrected");
    setAudio({ path, url, loadId: ++audioLoadIdRef.current });
    setAudioPlaying(false);
    setPlaybackFormants(null);
    setSegments([]);
    setCurrentTime(0);
    setDetectedLanguage(null);
    // New audio invalidates any prior corrections and the active session.
    setCorrections([]);
    setAiGen({ status: "idle" });
    setActiveSessionId(null);
    setHasUnsaved(true);
    setAudioDuration(0);
    setStatus({ kind: "ready" });
  };

  // ---- Sessions ----

  const canSaveSession = !!audio && !savingSession;

  const handleSaveSession = async () => {
    if (!audio) return;
    const data = {
      title: deriveTitle(segments),
      audio_path: audio.path,
      language: activeLanguage,
      model_id: activeModelId,
      duration: audioDuration || undefined,
      segments,
      corrections,
    };
    if (activeSessionId) {
      const updated = await api.updateSession(activeSessionId, data);
      if (!updated) throw new Error("The saved session no longer exists.");
    } else {
      const summary = await api.saveSession(data);
      setActiveSessionId(summary.id);
    }
    setHasUnsaved(false);
    void refreshSessions();
  };

  const autoSaveBeforeLeaving = async (): Promise<boolean> => {
    if (workspace !== "main" || !autoSaveAudio || !audio || (!hasUnsaved && activeSessionId)) return true;
    try {
      await handleSaveSession();
      return true;
    } catch (error) {
      setStatus({ kind: "error", message: `Could not auto-save recording: ${(error as Error).message}` });
      return false;
    }
  };

  const handleLoadSession = async (id: string) => {
    const sess = await api.loadSession(id);
    if (!sess) return;
    setActiveSessionId(sess.id);
    setSegments(sess.segments);
    setAudioDuration(sess.duration ?? 0);
    setCurrentTime(0);
    setAudioPlaying(false);
    setPlaybackFormants(null);
    if (sess.audio_url) {
      setAudio({
        path: sess.audio_stored_path ?? "",
        url: sess.audio_url,
        loadId: ++audioLoadIdRef.current,
      });
    }
    if (!sess.audio_url) setAudio(null);
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
    prepareAudio(file.path, file.url);
  };

  const handleRecordingReady = (path: string, url: string) => {
    prepareAudio(path, url);
  };

  const handleRetranscribe = () => {
    if (!audio || busy || anyRecordingBusy) return;
    transcriptionTarget.current = { setSegments, setDetectedLanguage, setAudioDuration, setHasUnsaved };
    setJobWorkspace(workspace);
    if (workspace === "main") setMainView("transcript");
    setTranscriptionRequest((request) => request + 1);
    setSegments([]);
    setCorrections([]);
    setAiGen({ status: "idle" });
    setHasUnsaved(true);
    setDetectedLanguage(null);
    setStatus({ kind: "transcribing" });
    void api.transcribe(audio.path, {
      temperature,
      model_id: activeModelId,
      language: activeLanguage,
    }).catch((error: Error) => setStatus({ kind: "error", message: error.message }));
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
    aiTarget.current = { segments, setAiGen, setCorrections, setHasUnsaved };
    setAiGen({ status: "generating", model });
    void api.ollamaCorrect(buildCorrectionPrompt(segments, activeLanguageName), model);
  };

  const busy =
    savingSession || status.kind === "transcribing" ||
    status.kind === "loading_model" ||
    status.kind === "downloading" || status.kind === "low_memory_retry";

  const mainRecording = useRecorder({ serverUrl, disabled: busy || workspace !== "main", onRecordingReady: handleRecordingReady });
  const youtubeRecording = useRecorder({ serverUrl, disabled: busy || workspace !== "youtube", onRecordingReady: handleRecordingReady });
  const mainRecordingBusy = ["requesting", "recording", "paused", "uploading"].includes(mainRecording.state.kind);
  const youtubeRecordingBusy = ["requesting", "recording", "paused", "uploading"].includes(youtubeRecording.state.kind);
  const mainRecorder = {
    ...mainRecording,
    canStart: mainRecording.canStart && !youtubeRecordingBusy,
    start: async () => {
      if (youtubeRecordingBusy || savingSessionRef.current || !mainRecording.canStart || aiGen.status === "generating") return false;
      savingSessionRef.current = true;
      setSavingSession(true);
      try {
        if (!await autoSaveBeforeLeaving()) return false;
        return await mainRecording.start();
      } finally {
        savingSessionRef.current = false;
        setSavingSession(false);
      }
    },
  };
  const youtubeRecorder = {
    ...youtubeRecording,
    canStart: youtubeRecording.canStart && !mainRecordingBusy,
    start: () => mainRecordingBusy ? Promise.resolve(false) : youtubeRecording.start(),
  };
  const anyRecordingBusy = mainRecordingBusy || youtubeRecordingBusy;
  const recorder = workspace === "youtube" ? youtubeRecorder : mainRecorder;
  const transcribingHere = busy && jobWorkspace === workspace;
  const clearRecording = async () => {
    if (busy || savingSessionRef.current || aiGen.status === "generating") return;
    savingSessionRef.current = true;
    setSavingSession(true);
    let saved: boolean;
    try {
      saved = await autoSaveBeforeLeaving();
    } finally {
      savingSessionRef.current = false;
      setSavingSession(false);
    }
    if (!saved) return;
    setAudio(null);
    setSegments([]);
    setCorrections([]);
    setCurrentTime(0);
    setAudioDuration(0);
    setDetectedLanguage(null);
    setActiveSessionId(null);
    setHasUnsaved(false);
    setAiGen({ status: "idle" });
    setTranscriptionRequest(0);
    setTranscriptDisplay("lyrics");
    setCorrectionView("corrected");
    setAudioPlaying(false);
    setPlaybackFormants(null);
    setCtxMenu(null);
    setCorrDialog(null);
    setStatus({ kind: "ready" });
    recorder.dismissError();
  };
  useEffect(() => {
    setCtxMenu(null);
    setCorrDialog(null);
    setAiModalOpen(false);
  }, [workspace]);

  const recordingBusy = ["requesting", "recording", "paused", "uploading"].includes(recorder.state.kind);

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
          onLoad={(id) => { if (!busy && !anyRecordingBusy) void handleLoadSession(id); }}
          onDelete={handleDeleteSession}
          onRename={handleRenameSession}
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
          <nav className="tab-bar" role="tablist" aria-label="Workspace mode" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const views = ["transcript", "vowels", "youtube"] as const;
            const next = event.key === "Home" ? views[0] : event.key === "End" ? views[views.length - 1]
              : views[(views.indexOf(mainView) + (event.key === "ArrowRight" ? 1 : views.length - 1)) % views.length];
            setMainView(next);
            document.getElementById(`tab-${next}`)?.focus();
          }}>
            <button className={`tab ${mainView === "transcript" ? "active" : ""}`} role="tab" id="tab-transcript" aria-controls="panel-transcript" aria-selected={mainView === "transcript"} tabIndex={mainView === "transcript" ? 0 : -1} onClick={() => setMainView("transcript")}>Transcribe</button>
            <button className={`tab ${mainView === "vowels" ? "active" : ""}`} role="tab" id="tab-vowels" aria-controls="panel-vowels" aria-selected={mainView === "vowels"} tabIndex={mainView === "vowels" ? 0 : -1} onClick={() => setMainView("vowels")}>Vowel practice</button>
            <button className={`tab ${mainView === "youtube" ? "active" : ""}`} role="tab" id="tab-youtube" aria-controls="panel-youtube" aria-selected={mainView === "youtube"} tabIndex={mainView === "youtube" ? 0 : -1} onClick={() => setMainView("youtube")}>Media</button>
          </nav>
          <div role="tabpanel" id="panel-transcript" className={!audio || recordingBusy ? "record-panel" : ""} aria-labelledby="tab-transcript" hidden={mainView !== "transcript"}>
          {(!audio || recordingBusy) && <section className={`record-stage ${audio && !recordingBusy ? "has-audio" : ""}`} aria-label="Record audio">
            <div className="record-intro">
              <span className="record-eyebrow">YOUR VOICE, YOUR WORKSPACE</span>
              <h1>{recorder.state.kind === "recording" ? "Listening." : audio ? "Make it yours." : "Start with your voice."}</h1>
              <p>{recorder.state.kind === "recording" ? "Take your time. Stop when you’re ready." : audio ? "Listen back, then turn your audio into words." : "Record a thought, a conversation, or a little practice."}</p>
            </div>
            <Recorder controller={recorder} prominent />
            {!recordingBusy && !busy && <button className="import-audio" onClick={handlePick}>
              {audio ? "or choose another audio file" : "or upload an audio file"}
            </button>}
            {busy && <p className="stage-progress" role="status"><Loader2 size={16} className="spin" /> {status.kind === "transcribing" ? "Turning your audio into words…" : "Preparing transcription…"}</p>}
          </section>}
          </div>
          <div className={mainView === "youtube" ? "youtube-practice-layout" : "shared-player-layout"}>
          <div role="tabpanel" id="panel-youtube" aria-labelledby="tab-youtube" hidden={mainView !== "youtube"}>
            <MediaWidget recorder={youtubeRecorder} active={mainView === "youtube"} />
          </div>
          {audio && !recordingBusy && <AudioBar
            key={workspace}
            onClear={clearRecording}
            clearDisabled={busy || aiGen.status === "generating"}
            compactStage={mainView === "youtube"}
            transcriptionRequest={transcriptionRequest}
            showStage={segments.length > 0 || transcribingHere}
            stage={segments.length > 0 ? <div className="transcript-stage">
              <div className="transcript-display-switch">
                <button aria-pressed={transcriptDisplay === "lyrics"} onClick={() => setTranscriptDisplay("lyrics")}>Lyrics</button>
                <button aria-pressed={transcriptDisplay === "edit"} onClick={() => setTranscriptDisplay("edit")}>Edit transcript</button>
              </div>
              {transcriptDisplay === "lyrics" ? <LyricsTranscript segments={segments} corrections={corrections} view={correctionView} currentTime={currentTime} onSeek={handleSeek} onRequestContextMenu={handleRequestContextMenu} /> :
                <CodeTranscript segments={segments} corrections={corrections} view={correctionView} seekInCorrected={seekInCorrected} currentTime={currentTime} onSeek={handleSeek} onRequestContextMenu={handleRequestContextMenu} />}
            </div> : transcribingHere ? <div className="transcription-loading" role="status"><Loader2 size={24} className="spin" /><span>Turning your audio into words…</span></div> : null}
            compact={mainView === "vowels"}
            url={audio?.url ?? null}
            sourceKey={audio?.loadId ?? 0}
            segments={segments}
            currentTime={currentTime}
            onTimeChange={setCurrentTime}
            registerSeek={registerSeek}
            hasCorrections={corrections.length > 0}
            correctionView={correctionView}
            onCorrectionViewChange={setCorrectionView}
            onPlayingChange={setAudioPlaying}
            onPlaybackFormants={handlePlaybackFormants}
            analyzePlayback={mainView === "vowels"}
            actions={<>
              <button className="btn ghost" onClick={() => void recorder.start()} disabled={!recorder.canStart}>Record again</button>
              <button className={`btn primary transcribe-action ${transcribingHere || segments.length || transcriptionRequest > 0 ? "is-contracted" : ""}`} aria-label={transcribingHere ? "Transcribing" : segments.length || transcriptionRequest > 0 ? "Transcribe again" : "Transcribe"} title={transcribingHere ? "Transcribing…" : segments.length || transcriptionRequest > 0 ? "Transcribe again" : "Transcribe"} aria-busy={transcribingHere} onClick={handleRetranscribe} disabled={busy || anyRecordingBusy || !models.some((m) => m.id === activeModelId && m.usable)}>
                <span className="transcribe-label" aria-hidden>Transcribe</span>
                <span className="transcribe-icon" aria-hidden>{transcribingHere ? <Loader2 size={18} className="spin" /> : <RotateCcw size={18} />}</span>
              </button>
<WorkspaceToolbar
          audioPath={audio?.path ?? null}
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
          onLanguageChange={handleLanguageChange}
          onModelChange={handleModelChange}
          onOpenModelManager={() => setModelManagerOpen(true)}
          onOpenAiCorrect={() => setAiModalOpen(true)}
        />

            </>}
          />}
          </div>
          <div role="tabpanel" id="panel-vowels" aria-labelledby="tab-vowels" hidden={mainView !== "vowels"}>
            {mainView === "vowels" && <VowelStudio playbackFormants={playbackFormants} playbackActive={audioPlaying} hasRecording={!!audio} languageHint={detectedLanguage ?? activeLanguage} />}
          </div>
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
          autoSaveAudio={autoSaveAudio}
          onAutoSaveAudioChange={(v) => {
            localStorage.setItem("autoSaveAudio", String(v));
            setAutoSaveAudio(v);
          }}
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
