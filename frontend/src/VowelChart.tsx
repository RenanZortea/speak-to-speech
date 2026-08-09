import { useMemo, useRef } from "react";
import { ALL_VOWELS, type VowelReference } from "./vowelData";
import { bark } from "./lpc";

interface Point { f1: number; f2: number }
interface Props {
  vowels: VowelReference[];
  cursor: Point;
  live: Point | null;
  target: VowelReference | null;
  practice: boolean;
  onCursorChange: (point: Point) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTarget: (vowel: VowelReference) => void;
}

const W = 720, H = 500, PAD = 58;
const f1Min = Math.min(...ALL_VOWELS.map((v) => bark(v.f1))) - 0.7;
const f1Max = Math.max(...ALL_VOWELS.map((v) => bark(v.f1))) + 0.7;
const f2Min = Math.min(...ALL_VOWELS.map((v) => bark(v.f2))) - 0.7;
const f2Max = Math.max(...ALL_VOWELS.map((v) => bark(v.f2))) + 0.7;

function inverseBark(value: number): number { return 1960 * (value + 0.53) / (26.28 - value); }
function xy(point: Point): [number, number] {
  return [PAD + (f2Max - bark(point.f2)) / (f2Max - f2Min) * (W - 2 * PAD), PAD + (bark(point.f1) - f1Min) / (f1Max - f1Min) * (H - 2 * PAD)];
}

export function VowelChart({ vowels, cursor, live, target, practice, onCursorChange, onDragStart, onDragEnd, onTarget }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const ticks = useMemo(() => ({ f1: [300, 400, 500, 600, 700, 800, 900], f2: [800, 1200, 1600, 2000, 2400, 2800] }), []);
  const fromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    const x = Math.max(PAD, Math.min(W - PAD, (event.clientX - rect.left) * W / rect.width));
    const y = Math.max(PAD, Math.min(H - PAD, (event.clientY - rect.top) * H / rect.height));
    onCursorChange({
      f1: inverseBark(f1Min + (y - PAD) / (H - 2 * PAD) * (f1Max - f1Min)),
      f2: inverseBark(f2Max - (x - PAD) / (W - 2 * PAD) * (f2Max - f2Min)),
    });
  };
  const [cx, cy] = xy(cursor);
  return <svg ref={svg} className="vowel-chart" viewBox={`0 0 ${W} ${H}`}
    onPointerDown={(e) => { if (practice) return; e.currentTarget.setPointerCapture(e.pointerId); fromEvent(e); onDragStart(); }}
    onPointerMove={(e) => { if (!practice && e.currentTarget.hasPointerCapture(e.pointerId)) fromEvent(e); }}
    onPointerUp={(e) => { if (!practice) { e.currentTarget.releasePointerCapture(e.pointerId); onDragEnd(); } }}>
    <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="vowel-plot-bg" />
    {ticks.f1.map((f) => { const [, y] = xy({ f1: f, f2: 1000 }); return <g key={`f1-${f}`}><line x1={PAD} x2={W-PAD} y1={y} y2={y} className="vowel-grid"/><text x={PAD-10} y={y+4} textAnchor="end" className="vowel-axis-label">{f}</text></g>; })}
    {ticks.f2.map((f) => { const [x] = xy({ f1: 500, f2: f }); return <g key={`f2-${f}`}><line x1={x} x2={x} y1={PAD} y2={H-PAD} className="vowel-grid"/><text x={x} y={H-PAD+22} textAnchor="middle" className="vowel-axis-label">{f}</text></g>; })}
    <text x={W/2} y={H-8} textAnchor="middle" className="vowel-axis-title">F2 (Hz) · front ←</text>
    <text transform={`translate(16 ${H/2}) rotate(-90)`} textAnchor="middle" className="vowel-axis-title">F1 (Hz) · open →</text>
    {vowels.map((vowel) => { const [x,y] = xy(vowel); const selected = target?.ipa === vowel.ipa; return <g key={vowel.ipa} className={`vowel-reference ${practice ? "selectable" : ""}`} onPointerDown={(e) => { if (practice) { e.stopPropagation(); onTarget(vowel); } }}><circle cx={x} cy={y} r={selected ? 12 : 7}/><text x={x+10} y={y-10}>{vowel.ipa}</text></g>; })}
    {target && (() => { const [x,y] = xy(target); return <circle cx={x} cy={y} r={18} className="vowel-target"/>; })()}
    {!practice && <circle cx={cx} cy={cy} r={9} className="vowel-cursor"/>}
    {live && (() => { const [x,y] = xy(live); return <circle cx={x} cy={y} r={10} className="vowel-live"/>; })()}
  </svg>;
}
