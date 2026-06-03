import { Cpu, MemoryStick, Gauge, Settings, HardDrive, ArrowUpCircle, X } from "lucide-react";
import type { ResourceStats } from "./api";

interface Props {
  stats: ResourceStats | null;
  onOpenSettings: () => void;
  updateAvailable: boolean;
  onUpdateClick: () => void;
  onUpdateDismiss: () => void;
}

export function ResourceFooter({
  stats,
  onOpenSettings,
  updateAvailable,
  onUpdateClick,
  onUpdateDismiss,
}: Props) {
  const gpu = stats?.gpu;
  const vramPct =
    gpu?.available && gpu.vram_total
      ? ((gpu.vram_used ?? 0) / gpu.vram_total) * 100
      : null;

  return (
    <footer className="res-footer">
      <Meter
        icon={<Cpu size={12} />}
        label="CPU"
        pct={stats?.cpu_percent ?? null}
        text={stats ? `${Math.round(stats.cpu_percent)}%` : "—"}
      />
      <Meter
        icon={<MemoryStick size={12} />}
        label="RAM"
        pct={stats?.ram_percent ?? null}
        text={
          stats
            ? `${Math.round(stats.ram_percent)}% · ${fmtGB(stats.proc_ram)} app`
            : "—"
        }
        title={
          stats
            ? `System ${fmtGB(stats.ram_used)} / ${fmtGB(stats.ram_total)} · this app ${fmtGB(stats.proc_ram)}`
            : undefined
        }
      />
      {gpu?.available ? (
        <>
          <Meter
            icon={<Gauge size={12} />}
            label="GPU"
            pct={gpu.gpu_util ?? null}
            text={`${gpu.gpu_util ?? 0}%`}
            title={gpu.name}
          />
          <Meter
            icon={<HardDrive size={12} />}
            label="VRAM"
            pct={vramPct}
            text={`${fmtGB(gpu.vram_used ?? 0)} / ${fmtGB(gpu.vram_total ?? 0)}`}
            title={`${gpu.name} — video memory`}
          />
        </>
      ) : (
        <span className="res-nogpu">No GPU telemetry</span>
      )}

      {updateAvailable && (
        <span className="res-update">
          <button className="res-update-btn" onClick={onUpdateClick} title="An update is available">
            <ArrowUpCircle size={13} />
            <span>Update available</span>
          </button>
          <button className="res-update-x" onClick={onUpdateDismiss} title="Dismiss">
            <X size={12} />
          </button>
        </span>
      )}

      <button
        className={`res-settings ${updateAvailable ? "" : "ml-auto"}`}
        onClick={onOpenSettings}
        title="Resource settings"
      >
        <Settings size={14} />
      </button>
    </footer>
  );
}

function Meter({
  icon,
  label,
  pct,
  text,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  pct: number | null;
  text: string;
  title?: string;
}) {
  const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  const hot = clamped >= 85;
  const warm = clamped >= 65;
  return (
    <div className="res-meter" title={title}>
      <span className="res-meter-icon">{icon}</span>
      <span className="res-meter-label">{label}</span>
      <span className="res-bar">
        <span
          className={`res-bar-fill ${hot ? "hot" : warm ? "warm" : ""}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="res-meter-text">{text}</span>
    </div>
  );
}

function fmtGB(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
