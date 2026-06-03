import { useState } from "react";
import {
  FolderOpen,
  RotateCw,
  SlidersHorizontal,
  FileAudio,
  Download,
  FileText,
  FileCode,
  Captions,
  AlignLeft,
  Copy,
  Check,
  Cpu,
  Languages,
  Settings2,
} from "lucide-react";
import { Recorder } from "./Recorder";
import {
  api,
  type CatalogModel,
  type LanguageOption,
  type Segment,
} from "./api";
import { format, defaultFilename, toTxtPlain, type ExportFormat } from "./formats";

interface Props {
  audioPath: string | null;
  serverUrl: string | null;
  busy: boolean;
  temperature: number;
  segments: Segment[];
  models: CatalogModel[];
  languages: LanguageOption[];
  activeModelId: string;
  activeLanguage: string;
  detectedLanguage: string | null;
  onTemperatureChange: (t: number) => void;
  onPick: () => void;
  onRecordingReady: (path: string, url: string) => void;
  onRetranscribe: () => void;
  onLanguageChange: (lang: string) => void;
  onModelChange: (modelId: string) => void;
  onOpenModelManager: () => void;
}

export function Sidebar({
  audioPath,
  serverUrl,
  busy,
  temperature,
  segments,
  models,
  languages,
  activeModelId,
  activeLanguage,
  detectedLanguage,
  onTemperatureChange,
  onPick,
  onRecordingReady,
  onRetranscribe,
  onLanguageChange,
  onModelChange,
  onOpenModelManager,
}: Props) {
  const [flash, setFlash] = useState<{ kind: "saved" | "copied"; detail: string } | null>(null);

  const showFlash = (kind: "saved" | "copied", detail: string) => {
    setFlash({ kind, detail });
    window.setTimeout(() => setFlash(null), 2400);
  };

  const handleExport = async (fmt: ExportFormat) => {
    const content = format(segments, audioPath, fmt);
    const name = defaultFilename(audioPath, fmt);
    const saved = await api.saveText(content, name);
    if (saved) showFlash("saved", saved);
  };

  const handleCopy = async () => {
    const content = toTxtPlain(segments);
    try {
      await navigator.clipboard.writeText(content);
      showFlash("copied", `${segments.length} segments`);
    } catch {
      // Fallback for environments without async clipboard API
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showFlash("copied", `${segments.length} segments`);
    }
  };

  const canExport = segments.length > 0;

  return (
    <aside className="sidebar">
      <Section title="Source" icon={<FileAudio size={14} />}>
        <button className="btn primary" onClick={onPick} disabled={busy}>
          <FolderOpen size={16} />
          <span>{audioPath ? "Pick another file" : "Pick audio file"}</span>
        </button>
        <div className="sep">or</div>
        <Recorder
          serverUrl={serverUrl}
          disabled={busy}
          onRecordingReady={onRecordingReady}
        />
        {audioPath && (
          <div className="current-file" title={audioPath}>
            {fileName(audioPath)}
          </div>
        )}
      </Section>

      <Section title="Model" icon={<Cpu size={14} />}>
        <ModelSection
          models={models}
          activeModelId={activeModelId}
          busy={busy}
          onModelChange={onModelChange}
          onOpenModelManager={onOpenModelManager}
        />

        <div className="opt">
          <div className="opt-head">
            <span className="opt-label">
              <Languages size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              Language
            </span>
            {detectedLanguage && activeLanguage === "auto" && (
              <span className="opt-value" title="Detected by Whisper">
                detected: {detectedLanguage}
              </span>
            )}
          </div>
          <select
            className="lang-select"
            value={activeLanguage}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={busy}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <LanguageWarning
            activeLanguage={activeLanguage}
            model={models.find((m) => m.id === activeModelId)}
          />
        </div>
      </Section>

      <Section title="Options" icon={<SlidersHorizontal size={14} />}>
        <div className="opt">
          <div className="opt-head">
            <span className="opt-label">Temperature</span>
            <span className="opt-value">{temperature.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            disabled={busy}
          />
          <p className="opt-hint">
            0 = deterministic (recommended). Higher = more sampling — may help disfluent
            stretches, but the model can drift.
          </p>
        </div>

        <button
          className="btn ghost"
          onClick={onRetranscribe}
          disabled={busy || !audioPath}
          title="Re-run transcription with current options"
        >
          <RotateCw size={15} />
          <span>Re-transcribe</span>
        </button>
      </Section>

      <Section title="Export" icon={<Download size={14} />}>
        <div className="export-grid">
          <button
            className="btn ghost export-btn"
            onClick={() => handleExport("txt")}
            disabled={!canExport}
            title="Plain text with timestamps"
          >
            <FileText size={15} />
            <span>.txt timed</span>
          </button>
          <button
            className="btn ghost export-btn"
            onClick={() => handleExport("txt-plain")}
            disabled={!canExport}
            title="Plain text only, no timestamps"
          >
            <AlignLeft size={15} />
            <span>.txt plain</span>
          </button>
          <button
            className="btn ghost export-btn"
            onClick={() => handleExport("srt")}
            disabled={!canExport}
            title="SRT subtitles (importable into video players & editors)"
          >
            <Captions size={15} />
            <span>.srt</span>
          </button>
          <button
            className="btn ghost export-btn"
            onClick={() => handleExport("json")}
            disabled={!canExport}
            title="Full JSON with confidence scores"
          >
            <FileCode size={15} />
            <span>.json</span>
          </button>
        </div>
        <button
          className="btn ghost copy-btn"
          onClick={handleCopy}
          disabled={!canExport}
          title="Copy plain transcription text to clipboard"
        >
          <Copy size={15} />
          <span>Copy transcription</span>
        </button>
        {flash && (
          <div className="saved-flash" title={flash.detail}>
            <Check size={12} />
            <span>
              {flash.kind === "saved"
                ? `Saved to ${compactPath(flash.detail)}`
                : `Copied · ${flash.detail}`}
            </span>
          </div>
        )}
      </Section>
    </aside>
  );
}

function compactPath(p: string): string {
  const parts = p.split(/[/\\]/);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function ModelSection({
  models,
  activeModelId,
  busy,
  onModelChange,
  onOpenModelManager,
}: {
  models: CatalogModel[];
  activeModelId: string;
  busy: boolean;
  onModelChange: (id: string) => void;
  onOpenModelManager: () => void;
}) {
  const active = models.find((m) => m.id === activeModelId);
  const downloaded = models.filter((m) => m.present);

  return (
    <>
      <select
        className="model-select"
        value={activeModelId}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={busy}
      >
        {downloaded.length === 0 && (
          <option value={activeModelId} disabled>
            (no models downloaded)
          </option>
        )}
        {downloaded.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {active && (
        <div className="model-meta">
          <span>{fmtSize(active.size_on_disk || active.size_bytes)}</span>
          {active.present ? (
            <span className="model-meta-tag" title="On disk">downloaded</span>
          ) : (
            <span className="model-meta-tag warn" title="Not on disk yet">not downloaded</span>
          )}
        </div>
      )}
      <button
        className="btn ghost manage-models-btn"
        onClick={onOpenModelManager}
        disabled={busy}
      >
        <Settings2 size={14} />
        <span>Manage models…</span>
      </button>
    </>
  );
}

function LanguageWarning({
  activeLanguage,
  model,
}: {
  activeLanguage: string;
  model: CatalogModel | undefined;
}) {
  if (!model || activeLanguage === "auto") return null;
  if (model.languages.includes("multilingual")) return null;
  if (model.languages.includes(activeLanguage)) return null;
  return (
    <p className="opt-hint warn">
      Heads up: {model.name} is fine-tuned for {model.languages.join(", ")}. Using it with
      {" "}<code>{activeLanguage}</code> will likely give garbage output.
    </p>
  );
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="sb-section">
      <h3 className="sb-title">
        {icon}
        <span>{title}</span>
      </h3>
      <div className="sb-body">{children}</div>
    </section>
  );
}

function fileName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
