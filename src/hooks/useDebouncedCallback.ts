import { useEffect, useMemo, useRef } from "react";

export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number
): (...args: Args) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useMemo(() => {
    return (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);
    };
  }, [delayMs]);
}
