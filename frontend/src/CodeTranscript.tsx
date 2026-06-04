import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import type { Segment } from "./api";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  categoryColor,
  type AlignedWord,
  type Alignment,
} from "./alignment";

interface Props {
  segments: Segment[];
  alignment: Alignment | null;
  currentTime: number;
  onSeek: (t: number) => void;
}

type WordPos = {
  from: number; // full span incl. leading space (for click hit-testing)
  markFrom: number; // trimmed start (for the decoration underline)
  to: number;
  start: number;
  end: number;
  aw: AlignedWord | null; // pronunciation analysis for this word, if any
};

// --- decoration state: a base layer (pronunciation colors) + an active layer ---
const setBase = StateEffect.define<DecorationSet>();
const setActive = StateEffect.define<DecorationSet>();

const baseField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setBase)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const activeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setActive)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--fg)", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-he)" },
    ".cm-content": {
      fontFamily: "var(--font-he)",
      fontSize: "18px",
      lineHeight: "1.75",
      padding: "10px 14px 24px",
      caretColor: "transparent",
    },
    ".cm-line": { padding: "3px 4px", borderRadius: "5px" },
  },
  { dark: true },
);

function buildDoc(
  segments: Segment[],
  alignment: Alignment | null,
): { text: string; words: WordPos[] } {
  let text = "";
  const words: WordPos[] = [];
  let alignIdx = 0;

  segments.forEach((seg, si) => {
    const segWords = seg.words ?? [];
    if (segWords.length > 0) {
      for (const w of segWords) {
        const from = text.length;
        const lead = w.word.length - w.word.trimStart().length;
        text += w.word;
        const to = text.length;
        const aw = alignment?.words[alignIdx] ?? null;
        words.push({
          from,
          markFrom: from + lead,
          to,
          start: w.start,
          end: w.end,
          aw,
        });
        alignIdx++;
      }
    } else {
      text += seg.text;
    }
    if (si < segments.length - 1) text += "\n";
  });

  return { text, words };
}

function baseDecorations(words: WordPos[]): DecorationSet {
  const ranges = words
    .filter((w) => w.to > w.markFrom)
    .map((w) =>
      Decoration.mark({ class: `cm-w cm-w-${w.aw?.category ?? "unknown"}` }).range(
        w.markFrom,
        w.to,
      ),
    );
  return Decoration.set(ranges, true);
}

function phonTier(c: number): "high" | "med" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "med";
  return "low";
}

// Build the hover popover DOM for a word's pronunciation analysis.
function renderTip(aw: AlignedWord): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-pron-tip";
  root.dir = "ltr";

  const head = document.createElement("div");
  head.className = "cm-tip-head";
  const cat = document.createElement("span");
  cat.className = "cm-tip-cat";
  cat.style.color = categoryColor(aw.category);
  cat.textContent = CATEGORY_LABELS[aw.category];
  const confs = document.createElement("span");
  confs.className = "cm-tip-confs";
  confs.textContent =
    `word ${Math.round(aw.lexicalConf * 100)}%` +
    (aw.acousticConf !== null ? ` · sound ${Math.round(aw.acousticConf * 100)}%` : "");
  head.append(cat, confs);

  const hint = document.createElement("p");
  hint.className = "cm-tip-hint";
  hint.textContent = CATEGORY_HINTS[aw.category];

  root.append(head, hint);

  if (aw.phonemes.length > 0) {
    const strip = document.createElement("div");
    strip.className = "cm-tip-phonemes";
    for (const p of aw.phonemes) {
      const chip = document.createElement("span");
      chip.className = `cm-tip-ph conf-${phonTier(p.confidence)}`;
      const sym = document.createElement("span");
      sym.className = "cm-tip-ph-sym";
      sym.textContent = p.symbol;
      const cf = document.createElement("span");
      cf.className = "cm-tip-ph-conf";
      cf.textContent = String(Math.round(p.confidence * 100));
      chip.append(sym, cf);
      strip.append(chip);
    }
    root.append(strip);
  }
  return root;
}

export function CodeTranscript({ segments, alignment, currentTime, onSeek }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wordsRef = useRef<WordPos[]>([]);
  const onSeekRef = useRef(onSeek);
  const activeIdxRef = useRef<number>(-1);

  onSeekRef.current = onSeek;

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) return;

    const pronTooltip = hoverTooltip(
      (_view, pos) => {
        const w = wordsRef.current.find((w) => pos >= w.from && pos <= w.to);
        if (!w || !w.aw || w.aw.phonemes.length === 0) return null;
        const aw = w.aw;
        return {
          pos: w.markFrom,
          end: w.to,
          above: true,
          create: () => ({ dom: renderTip(aw) }),
        };
      },
      { hoverTime: 200 },
    );

    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          baseField,
          activeField,
          pronTooltip,
          editorTheme,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ dir: "rtl", lang: "he" }),
          EditorView.domEventHandlers({
            mousedown: (e, v) => {
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              const w = wordsRef.current.find((w) => pos >= w.from && pos <= w.to);
              if (w) onSeekRef.current(w.start);
              return false;
            },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Rebuild document + base decorations when the transcript or alignment changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { text, words } = buildDoc(segments, alignment);
    wordsRef.current = words;
    activeIdxRef.current = -1;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: setBase.of(baseDecorations(words)),
    });
  }, [segments, alignment]);

  // Update the active-word highlight as playback advances; scroll on change only.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const words = wordsRef.current;
    const idx = words.findIndex((w) => currentTime >= w.start && currentTime < w.end);
    const w = idx >= 0 ? words[idx] : null;
    view.dispatch({
      effects: setActive.of(
        w
          ? Decoration.set([Decoration.mark({ class: "cm-active-word" }).range(w.markFrom, w.to)])
          : Decoration.none,
      ),
    });
    if (idx !== activeIdxRef.current && w) {
      activeIdxRef.current = idx;
      view.dispatch({ effects: EditorView.scrollIntoView(w.from, { y: "nearest" }) });
    }
  }, [currentTime]);

  return (
    <div className="code-transcript">
      <div ref={hostRef} className="cm-host" />
      {segments.length === 0 && (
        <div className="transcript empty cm-empty">
          <span>No transcript yet — pick a file or record, then transcribe.</span>
        </div>
      )}
    </div>
  );
}
