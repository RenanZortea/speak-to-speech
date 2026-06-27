import { useEffect, useMemo, useState } from "react";
import { X, Copy, Check, Sparkles, AlertCircle, Cpu, Loader2, RefreshCw } from "lucide-react";
import { api } from "./api";
import type { Segment } from "./api";
import type { Correction } from "./corrections";
import {
  buildCorrectionPrompt,
  mapAiCorrections,
  parseAiJson,
  type AiGenState,
  type UnplacedCorrection,
} from "./aiCorrect";

interface Props {
  segments: Segment[];
  languageName: string;
  onApply: (corrections: Correction[]) => void;
  onClose: () => void;
  /** Ollama generation lifecycle, owned by App so it survives this modal closing. */
  ollamaGen: AiGenState;
  onOllamaGenerate: (model: string) => void;
}

export function CorrectAiModal({
  segments,
  languageName,
  onApply,
  onClose,
  ollamaGen,
  onOllamaGenerate,
}: Props) {
  const prompt = useMemo(
    () => buildCorrectionPrompt(segments, languageName),
    [segments, languageName],
  );
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  // Local result/error are for the manual paste path; the Ollama path reports
  // through `ollamaGen` (lifted to App).
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; unplaced: UnplacedCorrection[] } | null>(
    null,
  );

  // ---- Ollama model discovery (cheap; re-checked each open) ----
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [ollamaErr, setOllamaErr] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState<string>("");
  const generating = ollamaGen.status === "generating";

  const refreshOllama = async () => {
    setOllamaErr(null);
    setOllamaModels(null);
    const res = await api.ollamaListModels();
    if (res.error) {
      setOllamaErr(res.error);
      setOllamaModels([]);
      return;
    }
    setOllamaModels(res.models);
    setOllamaModel(res.selected || res.models[0] || "");
  };

  useEffect(() => {
    refreshOllama();
  }, []);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const apply = () => {
    setError(null);
    try {
      const json = parseAiJson(paste);
      const { corrections, unplaced } = mapAiCorrections(json, segments);
      if (corrections.length === 0 && unplaced.length === 0) {
        setError("No corrections found in the pasted JSON.");
        return;
      }
      onApply(corrections);
      setResult({ added: corrections.length, unplaced });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Prefer the manual-paste outcome if the user just used it; otherwise surface
  // the (possibly-while-closed) Ollama outcome.
  const shownError = error ?? (ollamaGen.status === "error" ? ollamaGen.error : null);
  const shownResult = result ?? (ollamaGen.status === "done" ? ollamaGen.result : null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
        <h2>
          <Sparkles size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
          Correct with AI
        </h2>
        <p className="modal-sub">
          Run a local model via Ollama, or copy the prompt into any AI and paste its
          JSON reply back. Either way the app maps the corrections onto your transcript.
        </p>

        <div className="ai-step ollama-panel">
          <div className="ai-step-head">
            <span className="ai-step-num">
              <Cpu size={13} />
            </span>
            <span>Run locally with Ollama</span>
            <button
              className="btn ghost ai-copy"
              onClick={refreshOllama}
              disabled={generating}
              title="Re-check Ollama"
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
          </div>

          {ollamaModels === null && !ollamaErr && (
            <div className="ollama-hint">
              <Loader2 size={14} className="spin" /> Checking for Ollama…
            </div>
          )}

          {ollamaErr && (
            <div className="ollama-hint">
              {ollamaErr} Start it (<code>ollama serve</code>) and click Refresh.
            </div>
          )}

          {ollamaModels && ollamaModels.length === 0 && !ollamaErr && (
            <div className="ollama-hint">
              Ollama is running but has no models. Pull one, e.g.{" "}
              <code>ollama pull llama3</code>, then Refresh.
            </div>
          )}

          {ollamaModels && ollamaModels.length > 0 && (
            <div className="ollama-run">
              <select
                className="ollama-select"
                value={generating ? ollamaGen.model : ollamaModel}
                onChange={(e) => {
                  setOllamaModel(e.target.value);
                  api.setOllamaModel(e.target.value);
                }}
                disabled={generating}
              >
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                onClick={() => onOllamaGenerate(ollamaModel)}
                disabled={generating || !ollamaModel}
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Generate corrections
                  </>
                )}
              </button>
            </div>
          )}
          {generating && (
            <div className="ollama-hint">
              Running locally — you can close this window; corrections apply when it finishes.
            </div>
          )}
        </div>

        <div className="ai-or">— or copy into any AI —</div>

        <div className="ai-step">
          <div className="ai-step-head">
            <span className="ai-step-num">1</span>
            <span>Copy this prompt and paste it into your AI</span>
            <button className="btn ghost ai-copy" onClick={copyPrompt}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <textarea className="ai-prompt" readOnly value={prompt} rows={6} />
        </div>

        <div className="ai-step">
          <div className="ai-step-head">
            <span className="ai-step-num">2</span>
            <span>Paste the AI's JSON reply here</span>
          </div>
          <textarea
            className="ai-paste"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setResult(null);
              setError(null);
            }}
            rows={6}
            placeholder='{ "corrections": [ … ] }'
          />
        </div>

        {shownError && (
          <div className="ai-error">
            <AlertCircle size={14} /> {shownError}
          </div>
        )}

        {shownResult && (
          <div className="ai-result">
            <Check size={14} /> Added {shownResult.added} correction
            {shownResult.added === 1 ? "" : "s"}.
            {shownResult.unplaced.length > 0 && (
              <span className="ai-unplaced">
                {" "}
                {shownResult.unplaced.length} couldn't be placed (quote not found in its segment).
              </span>
            )}
          </div>
        )}

        <div className="ai-actions">
          <button className="btn ghost" onClick={onClose}>
            {shownResult ? "Done" : "Cancel"}
          </button>
          <button className="btn primary" onClick={apply} disabled={!paste.trim()}>
            Apply corrections
          </button>
        </div>
      </div>
    </div>
  );
}
