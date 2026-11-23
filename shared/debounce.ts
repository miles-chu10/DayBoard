export interface Debounced {
  (): void;
  /** Drops a pending call. */
  cancel(): void;
}

/** Runs `fn` once, `waitMs` after the last call in a burst. */
export function debounce(fn: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, waitMs);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
