export type NoteSaveState = "saved" | "unsaved" | "saving";

export interface NoteDraft {
  title: string;
  body: string;
}

/**
 * The Notes editor's save queue: saves a moment after typing stops and whenever `flush` is
 * called. Saves run one at a time, so a new note is created once and later saves update it.
 */
export function createNoteAutosave(options: {
  id: string | undefined;
  persist: (note: NoteDraft & { id?: string }) => Promise<{ id: string }>;
  onState: (state: NoteSaveState) => void;
  delay?: number;
}) {
  let id = options.id;
  let pending: NoteDraft | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let discarded = false;
  let saving = false;
  let chain: Promise<boolean> = Promise.resolve(true);

  /** Resolves false when the save failed; the text is kept for the next flush. */
  function flush(): Promise<boolean> {
    clearTimeout(timer);
    chain = chain.then(async () => {
      // Typing can continue while persistence is awaiting IPC. Do not allow navigation until
      // those newer edits have also been saved.
      while (pending) {
        const draft = pending;
        pending = null;
        clearTimeout(timer);
        if (!id && !draft.title.trim() && !draft.body.trim()) {
          options.onState("saved");
          continue;
        }
        saving = true;
        options.onState("saving");
        try {
          id = (await options.persist({ ...(id ? { id } : {}), ...draft })).id;
          options.onState(pending ? "unsaved" : "saved");
        } catch {
          // Keep the failed draft, unless newer typing replaced it, so it is retried, not dropped.
          if (!discarded) pending ??= draft;
          options.onState("unsaved");
          return false;
        } finally {
          saving = false;
        }
      }
      return true;
    });
    return chain;
  }

  return {
    change(draft: NoteDraft): void {
      pending = draft;
      options.onState("unsaved");
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), options.delay ?? 600);
    },
    flush,
    hasPendingChanges: () => pending !== null || saving,
    /** Drops unsaved edits (the note is being deleted) and waits for a save already running. */
    async discard(): Promise<string | undefined> {
      clearTimeout(timer);
      // A save already running must not put its draft back if it fails.
      discarded = true;
      pending = null;
      await chain;
      return id;
    },
  };
}
