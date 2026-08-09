import { useEffect, useState } from "react";
import { X, Power, Trash2, Loader2, ArrowUpCircle, ExternalLink, MousePointerClick, FolderOpen } from "lucide-react";
import { api, type Settings, type UpdateInfo } from "./api";

interface Props {
  onClose: () => void;
  seekInCorrected: boolean;
  onSeekInCorrectedChange: (v: boolean) => void;
  updateInfo: UpdateInfo | null;
  updateProgress: { bytes: number; total: number } | null;
  onCheckUpdate: () => Promise<UpdateInfo>;
  onInstall: (url: string) => void;
}

export function SettingsModal({
  onClose,
  seekInCorrected,
  onSeekInCorrectedChange,
  updateInfo,
  updateProgress,
  onCheckUpdate,
  onInstall,
}: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [unloading, setUnloading] = useState(false);
  const [choosingDir, setChoosingDir] = useState(false);
  const [checking, setChecking] = useState(false);
  const [localUpdate, setLocalUpdate] = useState<UpdateInfo | null>(updateInfo);

  const refresh = () => api.getSettings().then(setSettings);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setLocalUpdate(updateInfo);
  }, [updateInfo]);

  const handleCheck = async () => {
    setChecking(true);
    const info = await onCheckUpdate();
    setLocalUpdate(info);
    setChecking(false);
  };

  const handleRelease = async (enabled: boolean) => {
    setSettings((s) => (s ? { ...s, release_when_idle: enabled } : s));
    await api.setReleaseWhenIdle(enabled);
  };

  const handleUnloadAll = async () => {
    setUnloading(true);
    const r = await api.unloadAllModels();
    setSettings((s) => (s ? { ...s, ...r } : s));
    setUnloading(false);
  };

  const handleChooseDir = async () => {
    setChoosingDir(true);
    const r = await api.chooseModelsDir();
    if (r?.changed) {
      setSettings((s) => (s ? { ...s, models_dir: r.models_dir, models_dir_custom: true } : s));
    }
    setChoosingDir(false);
  };

  const handleResetDir = async () => {
    setChoosingDir(true);
    const r = await api.resetModelsDir();
    setSettings((s) => (s ? { ...s, models_dir: r.models_dir, models_dir_custom: false } : s));
    setChoosingDir(false);
  };

  const anyLoaded = settings?.whisper_loaded ?? false;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
        <h2>Resources &amp; performance</h2>
        <p className="modal-sub">
          Control how much of your machine SpeakToSpeech uses.
        </p>

        {!settings ? (
          <div className="settings-loading">
            <Loader2 size={16} className="spin" /> <span>Loading…</span>
          </div>
        ) : (
          <div className="settings-body">
            <section className="settings-row">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.release_when_idle}
                  onChange={(e) => handleRelease(e.target.checked)}
                />
                <span className="settings-label">
                  <Power size={14} /> Release models when idle
                </span>
              </label>
              <p className="settings-hint">
                Unload a model from memory after each job finishes. Frees RAM/VRAM when
                you're not actively working — at the cost of a ~10s reload next time.
              </p>
            </section>

            <section className="settings-row">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={seekInCorrected}
                  onChange={(e) => onSeekInCorrectedChange(e.target.checked)}
                />
                <span className="settings-label">
                  <MousePointerClick size={14} /> Click to seek in Corrected view
                </span>
              </label>
              <p className="settings-hint">
                In Corrected view, click a word to jump the audio there. The playback
                highlight is always hidden in Corrected view — it tracks your original
                speech, whose word positions no longer line up once corrections apply.
              </p>
            </section>

            <section className="settings-row">
              <div className="settings-row-head">
                <span className="settings-label">
                  <FolderOpen size={14} /> Model storage
                </span>
                {settings.models_dir_custom && (
                  <button
                    className="btn-link"
                    onClick={handleResetDir}
                    disabled={choosingDir}
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <div className="settings-path" title={settings.models_dir}>
                {settings.models_dir}
              </div>
              <button
                className="btn ghost settings-choose-dir"
                onClick={handleChooseDir}
                disabled={choosingDir}
              >
                {choosingDir ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
                <span>Change folder…</span>
              </button>
              <p className="settings-hint">
                Where downloaded Whisper models are stored. New
                downloads and model loads use this folder immediately; models already
                downloaded elsewhere stay where they are — re-download them here if you
                want everything in one place.
              </p>
            </section>

            <section className="settings-row">
              <div className="settings-row-head">
                <span className="settings-label">Loaded models</span>
                <span className="settings-loaded-tags">
                  <span className={`tag ${settings.whisper_loaded ? "on" : "off"}`}>
                    Whisper {settings.whisper_loaded ? "loaded" : "idle"}
                  </span>
                </span>
              </div>
              <button
                className="btn ghost danger settings-unload"
                onClick={handleUnloadAll}
                disabled={unloading || !anyLoaded}
              >
                {unloading ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                <span>Unload all models</span>
              </button>
              <p className="settings-hint">
                Immediately frees all model memory. Models reload automatically on the
                next transcription.
              </p>
            </section>

            <section className="settings-row settings-about">
              <div className="settings-row-head">
                <span className="settings-label">Version</span>
                <span className="settings-value">v{settings.version}</span>
              </div>

              {localUpdate?.update_available ? (
                <div className="update-box">
                  <div className="update-head">
                    <ArrowUpCircle size={15} />
                    <span>
                      Update available — <strong>v{localUpdate.latest_version}</strong>
                    </span>
                  </div>
                  {localUpdate.notes && (
                    <pre className="update-notes">{trimNotes(localUpdate.notes)}</pre>
                  )}
                  {updateProgress ? (
                    <div className="update-progress">
                      <Loader2 size={13} className="spin" />
                      <span>
                        {updateProgress.total > 0
                          ? `Downloading ${pct(updateProgress)}% — the app will restart to finish.`
                          : "Starting download…"}
                      </span>
                    </div>
                  ) : (
                    <div className="update-actions">
                      {localUpdate.download_url && (
                        <button
                          className="btn primary"
                          onClick={() => onInstall(localUpdate.download_url!)}
                        >
                          <ArrowUpCircle size={14} />
                          <span>Download &amp; install</span>
                        </button>
                      )}
                      {localUpdate.html_url && (
                        <a
                          className="update-link"
                          href={localUpdate.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink size={12} /> Release notes
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="update-actions">
                  <button className="btn ghost" onClick={handleCheck} disabled={checking}>
                    {checking ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={13} />}
                    <span>{checking ? "Checking…" : "Check for updates"}</span>
                  </button>
                  {localUpdate && !localUpdate.update_available && !checking && (
                    <span className="update-uptodate">Up to date</span>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function trimNotes(s: string): string {
  const lines = s.split("\n").slice(0, 8);
  return lines.join("\n").slice(0, 600);
}

function pct(p: { bytes: number; total: number }): number {
  if (!p.total) return 0;
  return Math.min(100, Math.round((p.bytes / p.total) * 100));
}
