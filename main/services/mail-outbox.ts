import { randomUUID } from "node:crypto";

export type SendResult = { ok: true } | { ok: false; error: string };

/** Thrown by `drain` when an email it had to send did not go out. */
export class MailNotSentError extends Error {
  constructor(readonly failures: string[]) {
    super(
      failures.length === 1
        ? `An email couldn't be sent: ${failures[0]}`
        : `${failures.length} emails couldn't be sent: ${failures[0]}`,
    );
    this.name = "MailNotSentError";
  }
}

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/**
 * Holds each outgoing email for an undo window, then sends it. Cancel stops one that hasn't gone;
 * drain sends everything still held at once and throws when one fails, so quitting never
 * silently drops an email.
 */
export function createOutbox<T>(options: {
  send: (payload: T) => Promise<void>;
  onResult: (id: string, result: SendResult) => void;
  timers?: Timers;
}) {
  const timers = options.timers ?? systemTimers;
  const held = new Map<string, { payload: T; handle: unknown }>();
  const inFlight = new Set<Promise<SendResult>>();

  function dispatch(id: string): Promise<SendResult> | undefined {
    const entry = held.get(id);
    if (!entry) return undefined;
    held.delete(id);
    timers.clearTimeout(entry.handle);
    const sending: Promise<SendResult> = options.send(entry.payload).then(
      (): SendResult => ({ ok: true }),
      (error: unknown): SendResult => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    inFlight.add(sending);
    void sending.then((result) => {
      inFlight.delete(sending);
      options.onResult(id, result);
    });
    return sending;
  }

  return {
    /** Holds `payload` for `delayMs`; with no delay it sends now and resolves with the result. */
    queue(payload: T, delayMs: number): { id: string; sendAt: number; sent?: Promise<SendResult> } {
      const id = randomUUID();
      const delay = Math.max(0, Math.floor(delayMs));
      held.set(id, { payload, handle: undefined });
      if (!delay) return { id, sendAt: timers.now(), sent: dispatch(id) };
      held.get(id)!.handle = timers.setTimeout(() => void dispatch(id), delay);
      return { id, sendAt: timers.now() + delay };
    },
    /** True when the email was still held and won't be sent. */
    cancel(id: string): boolean {
      const entry = held.get(id);
      if (!entry) return false;
      timers.clearTimeout(entry.handle);
      held.delete(id);
      return true;
    },
    async drain(): Promise<void> {
      for (const id of [...held.keys()]) dispatch(id);
      const results = await Promise.all([...inFlight]);
      const failures = results.flatMap((result) => (result.ok ? [] : [result.error]));
      if (failures.length) throw new MailNotSentError(failures);
    },
    held: () => held.size,
  };
}
