import { useState, useRef, useCallback } from "react";

/**
 * useState + useRef combined — the ref always mirrors the latest state
 * so async callbacks can read the current value without stale closures.
 */
export function useRefState<T>(initial: T): [T, (v: T) => void, React.MutableRefObject<T>] {
  const [state, _setState] = useState<T>(initial);
  const ref = useRef<T>(initial);
  const setState = useCallback((v: T) => { ref.current = v; _setState(v); }, []);
  return [state, setState, ref];
}
