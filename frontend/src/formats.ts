import type { Segment } from "./api";

export type ExportFormat = "txt" | "txt-plain" | "srt" | "json";

export function format(segments: Segment[], audioPath: string | null, fmt: ExportFormat): string {
  switch (fmt) {
    case "txt":
      return toTxt(segments);
    case "txt-plain":
      return toTxtPlain(segments);
    case "srt":
      return toSrt(segments);
    case "json":
      return toJson(segments, audioPath);
  }
}

export function defaultFilename(audioPath: string | null, fmt: ExportFormat): string {
  const base = audioPath
    ? stripExt(basename(audioPath))
    : `transcript-${new Date().toISOString().slice(0, 10)}`;
  const ext = fmt === "txt-plain" ? "txt" : fmt;
  const suffix = fmt === "txt-plain" ? "-plain" : "";
  return `${base}${suffix}.${ext}`;
}

function toTxt(segments: Segment[]): string {
  return segments.map((s) => `[${shortTime(s.start)}] ${s.text.trim()}`).join("\n");
}

export function toTxtPlain(segments: Segment[]): string {
  return segments.map((s) => s.text.trim()).join("\n");
}

function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) =>
      [
        String(i + 1),
        `${srtTime(s.start)} --> ${srtTime(s.end)}`,
        s.text.trim(),
      ].join("\n"),
    )
    .join("\n\n") + "\n";
}

function toJson(segments: Segment[], audioPath: string | null): string {
  return JSON.stringify(
    {
      audio_path: audioPath,
      generated_at: new Date().toISOString(),
      segment_count: segments.length,
      segments,
    },
    null,
    2,
  );
}

function shortTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function srtTime(s: number): string {
  const hh = Math.floor(s / 3600).toString().padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  const ms = Math.floor((s * 1000) % 1000).toString().padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
