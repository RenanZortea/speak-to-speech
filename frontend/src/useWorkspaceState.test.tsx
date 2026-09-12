import { useState, type Dispatch, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { useWorkspaceState } from "./useWorkspaceState";

it("keeps delayed results and clearing scoped to their originating workspace", () => {
  let completeMainJob!: Dispatch<SetStateAction<string[]>>;
  const observed: string[][] = [];
  function Harness() {
    const [step, setStep] = useState(0);
    const workspace = [0, 4, 5].includes(step) ? "main" : "youtube";
    const [recordings, setRecordings] = useWorkspaceState<string[]>(workspace, []);
    observed[step] = recordings;
    if (step === 0) {
      completeMainJob = setRecordings;
      setRecordings(["main recording"]);
    }
    if (step === 1) setRecordings(["youtube recording"]);
    if (step === 2) completeMainJob((previous) => [...previous, "late transcript"]);
    if (step === 4) setRecordings([]);
    if (step < 6) setStep(step + 1);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  expect(observed[1]).toEqual([]);
  expect(observed[3]).toEqual(["youtube recording"]);
  expect(observed[4]).toEqual(["main recording", "late transcript"]);
  expect(observed[5]).toEqual([]);
  expect(observed[6]).toEqual(["youtube recording"]);
});
