import { useCallback, useEffect, useRef, useState } from "react";

import {
  OutboxEntry,
  deviceAll,
  deviceDelete,
  deviceSet,
  isOfflineError,
  newIdempotencyKey,
} from "../utils/deviceStore";

export type PendingState = "sending" | "offline" | "failed";

export interface PendingSend extends OutboxEntry {
  state: PendingState;
}

interface Options {
  /** Session id or draft code: the outbox holds only this target's sends. */
  target?: string;
  /** Sends one entry; resolves once the server has it. Retries reuse the same idempotency key. */
  send: (entry: OutboxEntry) => Promise<unknown>;
  /** The server answered: the caller's cache now has the post, so the pending copy goes. */
  onSent?: (entry: OutboxEntry) => void;
}

/**
 * Your input shows at once (§4.12, FP-3134): an answer or comment appears the moment it's sent,
 * marked "sending…". Offline, it waits on the device with "Will send when you're back online" and
 * goes as soon as the browser is back; any other failure stays in place with Retry and the text
 * intact. The idempotency key makes a retried send return the original post, never a second one.
 */
export const useOutbox = ({ target, send, onSent }: Options) => {
  const [pending, setPending] = useState<PendingSend[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const inFlight = useRef(new Set<string>());

  const setState = (key: string, state: PendingState) =>
    setPending(list => list.map(p => (p.idempotencyKey === key ? { ...p, state } : p)));

  const attempt = useCallback(async (entry: OutboxEntry) => {
    if (inFlight.current.has(entry.idempotencyKey)) return;
    inFlight.current.add(entry.idempotencyKey);
    setState(entry.idempotencyKey, "sending");
    try {
      await sendRef.current(entry);
      await deviceDelete("outbox", entry.idempotencyKey);
      setPending(list => list.filter(p => p.idempotencyKey !== entry.idempotencyKey));
      onSentRef.current?.(entry);
    } catch (error) {
      setState(entry.idempotencyKey, isOfflineError(error) ? "offline" : "failed");
    } finally {
      inFlight.current.delete(entry.idempotencyKey);
    }
  }, []);

  // Sends left on the device by an earlier visit (closed offline): show them and try again.
  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    void deviceAll<OutboxEntry>("outbox").then(entries => {
      if (!alive) return;
      const mine = entries.filter(e => e && e.target === target);
      if (mine.length === 0) return;
      setPending(list => {
        const known = new Set(list.map(p => p.idempotencyKey));
        return [
          ...list,
          ...mine
            .filter(e => !known.has(e.idempotencyKey))
            .map(e => ({ ...e, state: "offline" as PendingState })),
        ];
      });
      mine.forEach(entry => void attempt(entry));
    });
    return () => {
      alive = false;
    };
  }, [target, attempt]);

  useEffect(() => {
    const onOnline = () =>
      pendingRef.current.filter(p => p.state !== "sending").forEach(p => void attempt(p));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [attempt]);

  const enqueue = useCallback(
    (
      entry: Omit<OutboxEntry, "idempotencyKey" | "createdAt" | "target"> & {
        idempotencyKey?: string;
      },
    ) => {
      if (!target) return undefined;
      const full: OutboxEntry = {
        ...entry,
        target,
        idempotencyKey: entry.idempotencyKey ?? newIdempotencyKey(),
        createdAt: Date.now(),
      };
      setPending(list => [...list, { ...full, state: "sending" }]);
      // On the device before the network, so closing the page offline loses nothing.
      void deviceSet("outbox", full.idempotencyKey, full).then(() => attempt(full));
      return full.idempotencyKey;
    },
    [target, attempt],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = pending.find(p => p.idempotencyKey === key);
      if (entry) void attempt(entry);
    },
    [pending, attempt],
  );

  return { pending, enqueue, retry };
};
