import { useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Trash2,
  Pencil,
  Check,
  X,
  FileAudio,
} from "lucide-react";
import type { SessionSummary } from "./api";

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  hasUnsaved: boolean;
  canSave: boolean;
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function SessionsRail({
  collapsed,
  onToggleCollapsed,
  sessions,
  activeSessionId,
  hasUnsaved,
  canSave,
  onSave,
  onLoad,
  onDelete,
  onRename,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (collapsed) {
    return (
      <div className="sessions-rail collapsed">
        <button className="rail-icon-btn" onClick={onToggleCollapsed} title="Show sessions">
          <PanelLeftOpen size={18} />
        </button>
        <button
          className="rail-icon-btn"
          onClick={onSave}
          disabled={!canSave}
          title="Save current session"
        >
          <Save size={17} />
          {hasUnsaved && canSave && <span className="unsaved-dot" />}
        </button>
      </div>
    );
  }

  const startRename = (s: SessionSummary) => {
    setEditingId(s.id);
    setDraft(s.title);
  };
  const commitRename = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="sessions-rail">
      <div className="rail-header">
        <span className="rail-title">Sessions</span>
        <button className="rail-icon-btn" onClick={onToggleCollapsed} title="Hide sessions">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button className="btn primary rail-save" onClick={onSave} disabled={!canSave}>
        <Save size={15} />
        <span>{hasUnsaved ? "Save session" : "Saved"}</span>
        {hasUnsaved && canSave && <span className="unsaved-dot" />}
      </button>

      <div className="rail-list">
        {sessions.length === 0 && (
          <div className="rail-empty">No saved sessions yet.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`rail-item ${s.id === activeSessionId ? "active" : ""}`}
            onClick={() => editingId !== s.id && onLoad(s.id)}
          >
            {editingId === s.id ? (
              <div className="rail-edit" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <button className="rail-mini" onClick={() => commitRename(s.id)} title="Save name">
                  <Check size={13} />
                </button>
                <button className="rail-mini" onClick={() => setEditingId(null)} title="Cancel">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <>
                <div className="rail-item-main">
                  <span className="rail-item-title" title={s.title}>
                    <FileAudio size={12} />
                    <bdi dir="auto">{s.title}</bdi>
                  </span>
                  <span className="rail-item-meta">
                    {fmtDate(s.updated_at)}
                    {s.duration ? ` · ${fmtDur(s.duration)}` : ""}
                  </span>
                </div>
                <div className="rail-item-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="rail-mini" onClick={() => startRename(s)} title="Rename">
                    <Pencil size={12} />
                  </button>
                  <button
                    className="rail-mini danger"
                    onClick={() => {
                      if (confirm(`Delete "${s.title}"? This removes its saved audio too.`))
                        onDelete(s.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
