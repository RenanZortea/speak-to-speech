import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Check, Sparkles, AlertCircle, Cpu, Loader2, RefreshCw } from "lucide-react";
import { api, on, type OllamaStatusEvent } from "./api";
import type { Segment } from "./api";
import type { Correction } from "./corrections";
import {
  buildCorrectionPrompt,
  mapAiCorrections,
  parseAiJson,
  type UnplacedCorrection,
} from "./aiCorrect";

interface Props {
  segments: Segment[];
  languageName: string;
  onApply: (corrections: Correction[]) => void;
  onClose: () => void;
}

export function CorrectAiModal({ segments, languageName, onApply, onClose }: Props) {
  const prompt = useMemo(
    () => buildCorrectionPrompt(segments, languageName),
    [segments, languageName],
  );
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; unplaced: UnplacedCorrection[] } | null>(
    null,
  );

  // ---- Ollama (local LLM) ----
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [ollamaErr, setOllamaErr] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState<string>("");
  const [generating, setGenerating] = useState(false);

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

  // Latest segments for the event handler (avoids stale closure if user re-runs).
  const segRef = useRef(segments);
  segRef.current = segments;

  useEffect(() => {
    const off = on("ollama_status", (e: OllamaStatusEvent) => {
      if (e.status === "done") {
        setGenerating(false);
        setPaste(e.text);
        applyFrom(e.text, segRef.current);
      } else if (e.status === "error") {
        setGenerating(false);
        setError(e.error);
      }
    });
    return off;
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

  const applyFrom = (text: string, segs: Segment[]) => {
    setError(null);
    try {
      const json = parseAiJson(text);
      const { corrections, unplaced } = mapAiCorrections(json, segs);
      if (corrections.length === 0 && unplaced.length === 0) {
        setError("No corrections found in the JSON.");
        return;
      }
      onApply(corrections);
      setResult({ added: corrections.length, unplaced });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const apply = () => applyFrom(paste, segments);

  const generate = async () => {
    if (!ollamaModel) return;
    setError(null);
    setResult(null);
    setGenerating(true);
    try {
      await api.ollamaCorrect(prompt, ollamaModel);
    } catch (e) {
      setGenerating(false);
      setError((e as Error).message);
    }
  };

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
                value={ollamaModel}
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
              <button className="btn primary" onClick={generate} disabled={generating || !ollamaModel}>
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

        {error && (
          <div className="ai-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {result && (
          <div className="ai-result">
            <Check size={14} /> Added {result.added} correction{result.added === 1 ? "" : "s"}.
            {result.unplaced.length > 0 && (
              <span className="ai-unplaced">
                {" "}
                {result.unplaced.length} couldn't be placed (quote not found in its segment).
              </span>
            )}
          </div>
        )}

        <div className="ai-actions">
          <button className="btn ghost" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          <button className="btn primary" onClick={apply} disabled={!paste.trim()}>
            Apply corrections
          </button>
        </div>
      </div>
    </div>
  );
}
