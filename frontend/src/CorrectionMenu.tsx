import { Pencil, Plus, Trash2, Play, Copy } from "lucide-react";

export type MenuTarget = {
  x: number;
  y: number;
  from: number;
  to: number;
  original: string;
  existingId: string | null;
  time: number | null; // audio time at the click, for "Play from here"
};

interface Props {
  target: MenuTarget;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCopyWord: () => void;
  onPlay: () => void;
  onClose: () => void;
}

export function CorrectionMenu({ target, onAdd, onEdit, onDelete, onCopy, onCopyWord, onPlay, onClose }: Props) {
  const hasExisting = target.existingId !== null;
  return (
    <>
      <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="ctx-menu" style={{ left: target.x, top: target.y }}>
        {hasExisting ? (
          <>
            <button className="ctx-item" onClick={onEdit}>
              <Pencil size={13} /> <span>Edit correction</span>
            </button>
            <button className="ctx-item" onClick={onCopyWord}>
              <Copy size={13} /> <span>Copy corrected word</span>
            </button>
            <button className="ctx-item" onClick={onCopy}>
              <Copy size={13} /> <span>Copy corrected sentence</span>
            </button>
            <button className="ctx-item danger" onClick={onDelete}>
              <Trash2 size={13} /> <span>Delete correction</span>
            </button>
          </>
        ) : (
          <button className="ctx-item" onClick={onAdd} disabled={!target.original.trim()}>
            <Plus size={13} /> <span>Add correction</span>
          </button>
        )}
        {target.time !== null && (
          <>
            <div className="ctx-sep" />
            <button className="ctx-item" onClick={onPlay}>
              <Play size={13} /> <span>Play from here</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
