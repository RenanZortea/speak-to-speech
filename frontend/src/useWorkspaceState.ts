import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export type RecordingWorkspace = "main" | "youtube";

/** Setters retain their workspace even when an asynchronous operation finishes after a tab switch. */
export function useWorkspaceState<T>(workspace: RecordingWorkspace, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [values, setValues] = useState<Record<RecordingWorkspace, T>>({ main: initial, youtube: initial });
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    setValues((previous) => ({
      ...previous,
      [workspace]: typeof value === "function"
        ? (value as (previous: T) => T)(previous[workspace]) : value,
    }));
  }, [workspace]);
  return [values[workspace], setValue];
}
