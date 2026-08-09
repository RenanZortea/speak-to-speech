import { useEffect, useRef } from "react";
import {
  EditorState,
  StateEffect,
  StateField,
  type StateEffectType,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import type { Segment } from "./api";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  correctedSentenceAt,
  type Correction,
} from "./corrections";
import { buildTranscriptDoc, type DocWord } from "./transcriptDoc";
import type { MenuTarget } from "./CorrectionMenu";

export type CorrectionView = "corrected" | "original";

interface Props {
  segments: Segment[];
  corrections: Correction[];
  view: CorrectionView;
  seekInCorrected: boolean;
  currentTime: number;
  onSeek: (t: number) => void;
  onRequestContextMenu: (t: MenuTarget) => void;
}

const setActive = StateEffect.define<DecorationSet>();
const setCorr = StateEffect.define<DecorationSet>();

function makeField(effectType: StateEffectType<DecorationSet>) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(effectType)) deco = e.value;
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const activeField = makeField(setActive);
const corrField = makeField(setCorr);

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

// Replace decoration widget: shows the suggestion inline in place of the original.
class SuggestionWidget extends WidgetType {
  constructor(readonly corr: Correction) {
    super();
  }
  eq(other: SuggestionWidget) {
    return (
      this.corr.id === other.corr.id &&
      this.corr.suggestion === other.corr.suggestion &&
      this.corr.category === other.corr.category
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-sug";
    span.style.borderBottomColor = CATEGORY_COLOR[this.corr.category];
    span.dir = "auto";
    span.textContent = this.corr.suggestion;
    return span;
  }
  ignoreEvent() {
    return false; // let CM process clicks/contextmenu (seek, menu)
  }
}

// Correction layer depends on the view: corrected = replace widgets; original = tint marks.
function correctionDecorations(
  corrections: Correction[],
  view: CorrectionView,
  docLen: number,
): DecorationSet {
  const valid = corrections
    .filter((c) => c.to > c.from && c.to <= docLen)
    .sort((a, b) => a.from - b.from);
  // Drop overlaps (replace decorations can't overlap).
  const nonOverlap: Correction[] = [];
  let lastTo = -1;
  for (const c of valid) {
    if (c.from >= lastTo) {
      nonOverlap.push(c);
      lastTo = c.to;
    }
  }
  const ranges = nonOverlap.map((c) =>
    view === "corrected"
      ? Decoration.replace({ widget: new SuggestionWidget(c) }).range(c.from, c.to)
      : Decoration.mark({
          class: "cm-corr",
          attributes: { style: `background-color:${CATEGORY_COLOR[c.category]}22` },
        }).range(c.from, c.to),
  );
  return Decoration.set(ranges, true);
}

// True when the doc on screen is the verbatim original — i.e. word char offsets
// still line up with the audio timings. In the corrected view with corrections
// applied, replace widgets shift the visible text, so word-anchored behaviour
// (click-to-seek, active-word highlight) can't be trusted.
function showingOriginal(view: CorrectionView, hasCorrections: boolean): boolean {
  return view === "original" || !hasCorrections;
}

function renderCorrTip(
  c: Correction,
  view: CorrectionView,
  correctedSentence: string,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-corr-tip";
  root.dir = "ltr";
  const head = document.createElement("div");
  head.className = "cm-tip-head";
  const cat = document.createElement("span");
  cat.className = "cm-tip-cat";
  cat.style.color = CATEGORY_COLOR[c.category];
  cat.textContent = CATEGORY_LABEL[c.category];
  head.append(cat);
  root.append(head);

  const line = document.createElement("div");
  line.className = "cm-corr-tip-line";
  if (view === "corrected") {
    const lbl = document.createElement("span");
    lbl.className = "cm-corr-tip-lbl";
    lbl.textContent = "you said";
    const s = document.createElement("s");
    s.className = "cm-corr-strike";
    s.dir = "auto";
    s.textContent = c.original;
    line.append(lbl, s);
  } else {
    const lbl = document.createElement("span");
    lbl.className = "cm-corr-tip-lbl";
    lbl.textContent = "correction";
    const sug = document.createElement("span");
    sug.className = "cm-corr-sug";
    sug.dir = "auto";
    sug.textContent = c.suggestion;
    line.append(lbl, sug);
  }
  root.append(line);

  if (c.explanation) {
    const note = document.createElement("p");
    note.className = "cm-corr-tip-note";
    note.textContent = c.explanation;
    root.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "cm-tip-actions";
  if (c.suggestion) actions.append(copyButton("Copy word", c.suggestion));
  if (correctedSentence) actions.append(copyButton("Copy sentence", correctedSentence));
  if (actions.childElementCount > 0) root.append(actions);
  return root;
}

// A clipboard button for use inside a hover tooltip. preventDefault on mousedown
// keeps the tooltip alive (and stops the editor from treating it as a seek click).
function copyButton(label: string, text: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cm-tip-copy";
  btn.textContent = label;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(text);
    btn.textContent = "Copied ✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("copied");
    }, 1200);
  });
  return btn;
}

export function CodeTranscript({
  segments,
  corrections,
  view,
  seekInCorrected,
  currentTime,
  onSeek,
  onRequestContextMenu,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wordsRef = useRef<DocWord[]>([]);
  const correctionsRef = useRef<Correction[]>(corrections);
  const modeRef = useRef<CorrectionView>(view);
  const seekInCorrectedRef = useRef(seekInCorrected);
  const onSeekRef = useRef(onSeek);
  const onCtxRef = useRef(onRequestContextMenu);
  const activeIdxRef = useRef<number>(-1);

  onSeekRef.current = onSeek;
  onCtxRef.current = onRequestContextMenu;
  correctionsRef.current = corrections;
  modeRef.current = view;
  seekInCorrectedRef.current = seekInCorrected;

  useEffect(() => {
    if (!hostRef.current) return;

    const tip = hoverTooltip(
      (v, pos) => {
        const c = correctionsRef.current.find((c) => pos >= c.from && pos <= c.to);
        if (c) {
          const sentence = correctedSentenceAt(
            v.state.doc.toString(),
            correctionsRef.current,
            c.from,
            c.to,
          );
          return {
            pos: c.from,
            end: c.to,
            above: true,
            create: () => ({ dom: renderCorrTip(c, modeRef.current, sentence) }),
          };
        }
        return null;
      },
      { hoverTime: 200 },
    );

    const cmView = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          corrField,
          activeField,
          tip,
          editorTheme,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ dir: "rtl", lang: "he" }),
          EditorView.domEventHandlers({
            mousedown: (e, v) => {
              if (e.button !== 0) return false;
              if (
                !showingOriginal(modeRef.current, correctionsRef.current.length > 0) &&
                !seekInCorrectedRef.current
              )
                return false;
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              const w = wordsRef.current.find((w) => pos >= w.from && pos <= w.to);
              if (w) onSeekRef.current(w.start);
              return false;
            },
            contextmenu: (e, v) => {
              e.preventDefault();
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return true;

              const corrAt = correctionsRef.current.find((c) => pos >= c.from && pos <= c.to);
              let from: number, to: number, original: string, existingId: string | null;
              if (corrAt) {
                from = corrAt.from;
                to = corrAt.to;
                original = corrAt.original;
                existingId = corrAt.id;
              } else {
                const sel = v.state.selection.main;
                if (!sel.empty && pos >= sel.from && pos <= sel.to) {
                  from = sel.from;
                  to = sel.to;
                } else {
                  const w = wordsRef.current.find((w) => pos >= w.from && pos <= w.to);
                  if (!w) return true;
                  from = w.markFrom;
                  to = w.to;
                }
                original = v.state.doc.sliceString(from, to).trim();
                existingId = null;
              }
              const wf = wordsRef.current.find((w) => from >= w.from && from <= w.to);
              onCtxRef.current({
                x: e.clientX,
                y: e.clientY,
                from,
                to,
                original,
                existingId,
                time: wf ? wf.start : null,
              });
              return true;
            },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = cmView;
    return () => {
      cmView.destroy();
      viewRef.current = null;
    };
  }, []);

  // Rebuild the document whenever the transcript changes.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const { text, words } = buildTranscriptDoc(segments);
    wordsRef.current = words;
    activeIdxRef.current = -1;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    v.dispatch({ effects: setCorr.of(correctionDecorations(corrections, view, v.state.doc.length)) });
  }, [segments]);

  // Rebuild the correction layer when corrections or the view toggle change.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: setCorr.of(correctionDecorations(corrections, view, v.state.doc.length)),
    });
  }, [corrections, view]);

  // Active-word highlight synced to playback (original view only — on corrected
  // text the base-offset marks land inside replaced spans and render wrong).
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    if (!showingOriginal(view, corrections.length > 0)) {
      v.dispatch({ effects: setActive.of(Decoration.none) });
      activeIdxRef.current = -1;
      return;
    }
    const words = wordsRef.current;
    const idx = words.findIndex((w) => currentTime >= w.start && currentTime < w.end);
    const w = idx >= 0 ? words[idx] : null;
    v.dispatch({
      effects: setActive.of(
        w
          ? Decoration.set([Decoration.mark({ class: "cm-active-word" }).range(w.markFrom, w.to)])
          : Decoration.none,
      ),
    });
    if (idx !== activeIdxRef.current && w) {
      activeIdxRef.current = idx;
      v.dispatch({ effects: EditorView.scrollIntoView(w.from, { y: "nearest" }) });
    }
  }, [currentTime, view, corrections]);

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
