import { useEffect, useState } from "react";
import { X, Cpu, Power, Trash2, Loader2, ArrowUpCircle, ExternalLink } from "lucide-react";
import { api, type Settings, type UpdateInfo } from "./api";

interface Props {
  onClose: () => void;
  updateInfo: UpdateInfo | null;
  updateProgress: { bytes: number; total: number } | null;
  onCheckUpdate: () => Promise<UpdateInfo>;
  onInstall: (url: string) => void;
}

export function SettingsModal({
  onClose,
  updateInfo,
  updateProgress,
  onCheckUpdate,
  onInstall,
}: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [unloading, setUnloading] = useState(false);
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

  const handleThreads = async (n: number) => {
    setSettings((s) => (s ? { ...s, cpu_threads: n } : s));
    await api.setCpuThreads(n);
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

  const anyLoaded = settings?.whisper_loaded || settings?.pron_loaded;

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
              <div className="settings-row-head">
                <span className="settings-label">
                  <Cpu size={14} /> CPU threads
                </span>
                <span className="settings-value">
                  {settings.cpu_threads} / {settings.cpu_count}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={settings.cpu_count}
                step={1}
                value={settings.cpu_threads}
                onChange={(e) => handleThreads(parseInt(e.target.value, 10))}
              />
              <p className="settings-hint">
                Caps threads used by CPU inference (pronunciation). Lower = leaves more
                cores for your other work; higher = faster analysis.
              </p>
            </section>

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
              <div className="settings-row-head">
                <span className="settings-label">Loaded models</span>
                <span className="settings-loaded-tags">
                  <span className={`tag ${settings.whisper_loaded ? "on" : "off"}`}>
                    Whisper {settings.whisper_loaded ? "loaded" : "idle"}
                  </span>
                  <span className={`tag ${settings.pron_loaded ? "on" : "off"}`}>
                    Pronunciation {settings.pron_loaded ? "loaded" : "idle"}
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
                Immediately frees all model memory. They reload automatically on the next
                transcription or analysis.
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
