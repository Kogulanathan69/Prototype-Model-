import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo for an immutable value.
 * - commit(next): records the current value in history, then sets next.
 * - replace(next): sets next without touching history (used while dragging).
 * - checkpoint(): records the current value, so a following series of replace() calls undoes as one step.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const ref = useRef(state);
  ref.current = state;

  const set = (s: typeof state) => {
    ref.current = s;
    setState(s);
  };

  const commit = useCallback((next: T) => {
    const s = ref.current;
    set({ past: [...s.past, s.present].slice(-100), present: next, future: [] });
  }, []);

  const replace = useCallback((next: T) => {
    set({ ...ref.current, present: next });
  }, []);

  const checkpoint = useCallback(() => {
    const s = ref.current;
    set({ past: [...s.past, s.present].slice(-100), present: s.present, future: [] });
  }, []);

  const reset = useCallback((value: T) => set({ past: [], present: value, future: [] }), []);

  const undo = useCallback(() => {
    const s = ref.current;
    if (!s.past.length) return;
    set({ past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] });
  }, []);

  const redo = useCallback(() => {
    const s = ref.current;
    if (!s.future.length) return;
    set({ past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) });
  }, []);

  /** The latest value, even before React re-renders (safe inside event handlers). */
  const get = useCallback(() => ref.current.present, []);

  return {
    value: state.present,
    get,
    commit,
    replace,
    checkpoint,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
