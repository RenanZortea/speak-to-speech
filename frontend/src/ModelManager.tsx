import { useEffect, useState } from "react";
import {
  X,
  Download,
  Trash2,
  Check,
  CircleCheck,
  Loader2,
  PlusCircle,
  ExternalLink,
  Globe,
  Languages,
  Square,
  Info,
} from "lucide-react";
import { api, on, type CatalogModel, type ModelDownloadEvent } from "./api";

interface Props {
  models: CatalogModel[];
  activeModelId: string;
  currentLoadedId: string | null;
  busy: boolean; // app is transcribing — block destructive actions
  onClose: () => void;
  onActivate: (modelId: string) => void;
  onRefresh: () => void;
}

type DownloadProgress = {
  bytes: number;
  status: "downloading" | "complete" | "cancelled" | "error";
  error?: string;
};

export function ModelManager({
  models,
  activeModelId,
  currentLoadedId,
  busy,
  onClose,
  onActivate,
  onRefresh,
}: Props) {
  // Per-model progress, keyed by model_id.
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [customId, setCustomId] = useState("");

  useEffect(() => {
    const off = on("model_download", (p: ModelDownloadEvent) => {
      setProgress((prev) => ({
        ...prev,
        [p.model_id]:
          p.status === "downloading"
            ? { bytes: p.bytes, status: "downloading" }
            : p.status === "complete"
            ? { bytes: p.bytes, status: "complete" }
            : p.status === "cancelled"
            ? { bytes: p.bytes, status: "cancelled" }
            : { bytes: 0, status: "error", error: p.error },
      }));
      // A custom-ID download has no card until the backend discovers the new
      // cache dir; keep refreshing until it shows up so progress is visible.
      if (p.status === "downloading" && !models.some((m) => m.id === p.model_id)) {
        onRefresh();
      }
      if (p.status === "complete" || p.status === "error" || p.status === "cancelled") {
        // refresh catalog so presence/size flip
        onRefresh();
        // clear the per-card state after a beat (for complete & cancelled)
        if (p.status === "complete" || p.status === "cancelled") {
          window.setTimeout(() => {
            setProgress((prev) => {
              const next = { ...prev };
              delete next[p.model_id];
              return next;
            });
          }, 1600);
        }
      }
    });
    return () => off();
  }, [onRefresh, models]);

  const handleDownload = async (modelId: string) => {
    setProgress((prev) => ({ ...prev, [modelId]: { bytes: 0, status: "downloading" } }));
    await api.downloadModelById(modelId);
  };

  const handleCancel = async (modelId: string) => {
    await api.cancelDownload(modelId);
    // backend will emit a {"status": "cancelled"} event which clears UI state
  };

  const handleDelete = async (modelId: string) => {
    if (busy) return;
    if (!confirm(`Delete ${modelId} from disk? You can re-download anytime.`)) return;
    setDeleting((prev) => new Set(prev).add(modelId));
    await api.deleteModel(modelId);
    setDeleting((prev) => {
      const next = new Set(prev);
      next.delete(modelId);
      return next;
    });
    onRefresh();
  };

  const handleAddCustom = async () => {
    const id = customId.trim();
    if (!id || !id.includes("/")) {
      alert("Enter a HuggingFace repo ID like `org/repo-name`.");
      return;
    }
    setCustomId("");
    await handleDownload(id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal model-manager-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>

        <h2>Model manager</h2>
        <p className="modal-sub">
          Switch between Whisper models, download new ones, or free up disk. Active model
          stays loaded across transcriptions.
        </p>

        <div className="mm-tip">
          <Info size={13} />
          <span>
            Slow downloads? HuggingFace rate-limits anonymous requests. Setting a free
            <code>HF_TOKEN</code> environment variable before launching gives ~10× the
            throughput — see{" "}
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
            >
              huggingface.co/settings/tokens
            </a>
            .
          </span>
        </div>

        <div className="mm-list">
          {models.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              isActive={m.id === activeModelId}
              isLoaded={m.id === currentLoadedId}
              progress={progress[m.id]}
              deleting={deleting.has(m.id)}
              busy={busy}
              onDownload={() => handleDownload(m.id)}
              onDelete={() => handleDelete(m.id)}
              onUse={() => onActivate(m.id)}
              onCancel={() => handleCancel(m.id)}
            />
          ))}
        </div>

        <div className="mm-custom">
          <PlusCircle size={14} />
          <input
            type="text"
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="Custom HF repo ID (e.g. some-user/whisper-spanish-ct2)"
            className="mm-custom-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddCustom();
            }}
          />
          <button
            className="btn ghost"
            onClick={handleAddCustom}
            disabled={!customId.trim()}
            title="Download a model from HuggingFace by repo ID"
          >
            <Download size={14} />
            <span>Download</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  isActive,
  isLoaded,
  progress,
  deleting,
  busy,
  onDownload,
  onDelete,
  onUse,
  onCancel,
}: {
  model: CatalogModel;
  isActive: boolean;
  isLoaded: boolean;
  progress: DownloadProgress | undefined;
  deleting: boolean;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onUse: () => void;
  onCancel: () => void;
}) {
  const isMulti = model.languages.includes("multilingual");
  const sizeLabel = fmtSize(model.size_on_disk || model.size_bytes);
  const isDownloading = progress?.status === "downloading";

  return (
    <div className={`mm-card ${isActive ? "active" : ""}`}>
      <div className="mm-card-head">
        <div className="mm-card-title">
          <span className="mm-name">{model.name}</span>
          {isLoaded && (
            <span className="mm-tag tag-loaded" title="Loaded in VRAM right now">
              <CircleCheck size={11} /> loaded
            </span>
          )}
          {isActive && !isLoaded && (
            <span className="mm-tag tag-active" title="Selected for next transcribe">
              <Check size={11} /> active
            </span>
          )}
        </div>
        <div className="mm-card-meta">
          <span className="mm-publisher">by {model.publisher}</span>
          <span className="mm-sep">·</span>
          <span className="mm-lang" title={`Trained for: ${model.languages.join(", ")}`}>
            {isMulti ? (
              <>
                <Globe size={11} /> multilingual
              </>
            ) : (
              <>
                <Languages size={11} /> {model.languages.join(", ")}
              </>
            )}
          </span>
          <span className="mm-sep">·</span>
          <span className="mm-size">{sizeLabel}</span>
        </div>
      </div>

      <p className="mm-desc">{model.description}</p>

      {isDownloading && (
        <div className="mm-progress">
          <div className="mm-progress-bar">
            <div
              className="mm-progress-fill"
              style={{ width: `${pct(progress!.bytes, model.size_bytes)}%` }}
            />
          </div>
          <span className="mm-progress-text">
            {fmtSize(progress!.bytes)} / ~{fmtSize(model.size_bytes)}
          </span>
        </div>
      )}
      {progress?.status === "cancelled" && (
        <div className="mm-cancelled">Cancelled — partial files left in HF cache (resumable).</div>
      )}
      {progress?.status === "error" && (
        <div className="mm-error">Download failed: {progress.error}</div>
      )}

      <div className="mm-card-actions">
        {!model.present && !isDownloading && (
          <button className="btn primary" onClick={onDownload}>
            <Download size={14} />
            <span>Download</span>
          </button>
        )}

        {isDownloading && (
          <>
            <button className="btn" disabled>
              <Loader2 size={14} className="spin" />
              <span>Downloading…</span>
            </button>
            <button
              className="btn ghost danger"
              onClick={onCancel}
              title="Cancel the in-progress download"
            >
              <Square size={12} fill="currentColor" />
              <span>Cancel</span>
            </button>
          </>
        )}

        {model.present && !isActive && (
          <button className="btn primary" onClick={onUse}>
            <Check size={14} />
            <span>Use</span>
          </button>
        )}

        {model.present && (
          <button
            className="btn ghost danger"
            onClick={onDelete}
            disabled={busy || deleting}
            title={busy ? "Finish current transcription first" : "Remove from HF cache"}
          >
            {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            <span>{deleting ? "Deleting…" : "Delete"}</span>
          </button>
        )}

        <a
          className="mm-link"
          href={`https://huggingface.co/${model.id}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on HuggingFace"
        >
          <ExternalLink size={12} />
          <span>{model.id}</span>
        </a>
      </div>
    </div>
  );
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function pct(now: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(1, (now / total) * 100));
}
