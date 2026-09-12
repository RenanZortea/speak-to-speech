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

  const startRename = (s: SessionSummary) => {
    setEditingId(s.id);
    setDraft(s.title);
  };
  const commitRename = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  };

  return (
    <div className={`sessions-rail ${collapsed ? "collapsed" : ""}`}>
      <div className="rail-header">
        <button className="rail-icon-btn" onClick={onToggleCollapsed}
          title={collapsed ? "Show sessions" : "Hide sessions"}
          aria-label={collapsed ? "Show sessions" : "Hide sessions"}
          aria-expanded={!collapsed} aria-controls="sessions-list">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <span className="rail-title">Sessions</span>
      </div>

      <button className="rail-icon-btn rail-save" onClick={onSave} disabled={!canSave}
        title="Save current session" aria-label="Save current session">
        <Save size={15} />
        <span>{hasUnsaved ? "Save session" : "Saved"}</span>
        {hasUnsaved && canSave && <span className="unsaved-dot" />}
      </button>

      <div id="sessions-list" className="rail-list" aria-hidden={collapsed}>
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
