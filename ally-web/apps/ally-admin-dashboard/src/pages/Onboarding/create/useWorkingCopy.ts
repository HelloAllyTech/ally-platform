import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useApplyWorkingCopyMutation,
  useEditWorkingCopyFieldMutation,
  useGetPendingChangesQuery,
  useGetWorkingCopyQuery,
} from "@api";
import type { ApplyResult, PendingChange, WorkingCopyView } from "@api";

import { FieldQueue } from "./fieldQueue";
import {
  EDIT_DEBOUNCE_MS,
  codeOf,
  errorOf,
  isCreditsRequired,
  messageOf,
  sameValue,
} from "./logic";

import type { FieldOutcome } from "./fieldQueue";

export interface FieldView {
  /** What the form shows: the builder's typed value, never replaced by a refusal or conflict. */
  value: unknown;
  /** The last value the server holds, as this tab knows it. */
  server: unknown;
  outcome: FieldOutcome;
  /** Typed but not yet saved, or being saved. */
  dirty: boolean;
}

/** What Apply said, for the pending bar and beside each field. */
export interface ApplyState {
  status: "idle" | "applying" | "applied" | "conflict" | "unavailable" | "failed" | "notLive";
  /** 422 `safety_conflict`: the reason, and the field it was about when known. */
  reason?: string | null;
  field?: string | null;
  /** Fields not applied, by field: their error code (`credits_required`). */
  notApplied: Record<string, string>;
  warnings: { field: string; message: string }[];
}

const IDLE_APPLY: ApplyState = { status: "idle", notApplied: {}, warnings: [] };

export interface WorkingCopy {
  wc: WorkingCopyView | undefined;
  loading: boolean;
  /** 404: the chatbot (a blank) was deleted while this tab was open. */
  gone: boolean;
  failed: boolean;
  live: boolean;
  /** The settings the test chatbot runs on now (for the "older settings" marker). */
  settingsHash: string;
  field: (name: string) => FieldView;
  /** Every field's shown value, for suggestions and the test pane. */
  values: Record<string, unknown>;
  /** The builder typed: shown at once, sent after a pause. */
  type: (name: string, value: unknown) => void;
  /** Leave the field (or a click on a choice): send now. Resolves with how it ended. */
  commit: (name: string, value?: unknown) => Promise<FieldOutcome>;
  /** After a conflict: take what the server says now. */
  reload: (name: string) => void;
  /** After a conflict: send mine on top of what the server says now. */
  overwrite: (name: string) => Promise<void>;
  /** A typed edit to this field has not been saved yet (Copilot asks first). */
  hasPendingEdit: (name: string) => boolean;
  /** Read the working copy again (after Copilot, a template, a source). */
  refresh: () => Promise<void>;
  /** A test reply's settings hash, kept as current when nothing changed since. */
  noteReplyHash: (hash: string | undefined) => void;
  pending: PendingChange[];
  apply: (fields?: string[]) => Promise<ApplyResult | null>;
  applyState: ApplyState;
  /** Set by any 402 `credits_required` seen here. */
  creditsOut: boolean;
  markCreditsOut: () => void;
}

/**
 * The working copy behind the Create and Build screen: one value and version per field, edited
 * through a per-field queue. Before go-live an edit is the chatbot itself; after it, the edit is
 * staged and the pending changes wait for Apply.
 */
export const useWorkingCopy = (draftId: string | null): WorkingCopy => {
  const query = useGetWorkingCopyQuery(draftId ?? "", { skip: !draftId });
  const wc = query.data;
  const live = Boolean(wc?.live);
  const pendingQuery = useGetPendingChangesQuery(draftId ?? "", { skip: !draftId || !live });
  const [editField] = useEditWorkingCopyFieldMutation();
  const [applyMutation] = useApplyWorkingCopyMutation();

  const [server, setServer] = useState<Record<string, unknown>>({});
  const [typed, setTyped] = useState<Record<string, unknown>>({});
  const [outcomes, setOutcomes] = useState<Record<string, FieldOutcome>>({});
  const [hash, setHash] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>(IDLE_APPLY);
  const [creditsOut, setCreditsOut] = useState(false);
  const typedRef = useRef(typed);
  typedRef.current = typed;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const editedSinceReply = useRef(false);
  const lastOutcome = useRef(new Map<string, FieldOutcome>());

  const queue = useMemo(
    () =>
      new FieldQueue({
        send: (field, value, version) =>
          editField({ id: draftId ?? "", field, value, version }).unwrap(),
        onSaved: (field, result, latest, sent) => {
          setServer(s => ({ ...s, [field]: result.value }));
          setHash(result.settingsHash);
          editedSinceReply.current = true;
          // The typed text goes once the server holds exactly it (no newer edit queued).
          if (latest) {
            setTyped(t => {
              if (!(field in t) || !sameValue(t[field], sent)) return t;
              const { [field]: _drop, ...rest } = t;
              void _drop;
              return rest;
            });
          }
        },
        onOutcome: (field, outcome) => {
          lastOutcome.current.set(field, outcome);
          if (outcome.status === "credits") setCreditsOut(true);
          setOutcomes(o => ({ ...o, [field]: outcome }));
        },
      }),
    // A queue per draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftId],
  );

  // A fresh read: every field nobody is editing follows the server.
  useEffect(() => {
    if (!wc) return;
    setServer(previous => {
      const next = { ...previous };
      for (const [name, f] of Object.entries(wc.fields)) {
        if (queue.busy(name)) continue;
        next[name] = f.value;
        // A field with typed text keeps its old base: if the server moved, sending it conflicts.
        if (!(name in typedRef.current)) queue.setBase(name, f.version);
      }
      return next;
    });
    setHash(wc.settingsHash);
  }, [wc, queue]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(timer => clearTimeout(timer));
  }, []);

  const refetchPending = useCallback(() => {
    if (live) void pendingQuery.refetch();
  }, [live, pendingQuery]);

  const send = useCallback(
    async (name: string, value: unknown): Promise<FieldOutcome> => {
      clearTimeout(timers.current.get(name));
      timers.current.delete(name);
      if (!draftId) return { status: "idle" };
      const outcome = outcomes[name];
      // A field showing a conflict waits for Reload or Overwrite.
      if (outcome?.status === "stale") return outcome;
      if (sameValue(value, server[name]) && !queue.busy(name)) {
        setTyped(t => {
          if (!(name in t)) return t;
          const { [name]: _drop, ...rest } = t;
          void _drop;
          return rest;
        });
        return { status: "saved" };
      }
      await queue.submit(name, value);
      refetchPending();
      return lastOutcome.current.get(name) ?? { status: "idle" };
    },
    [draftId, outcomes, server, queue, refetchPending],
  );

  const type = useCallback(
    (name: string, value: unknown) => {
      setTyped(t => ({ ...t, [name]: value }));
      setOutcomes(o =>
        o[name] && o[name].status !== "stale" ? { ...o, [name]: { status: "idle" } } : o,
      );
      clearTimeout(timers.current.get(name));
      timers.current.set(
        name,
        setTimeout(() => void send(name, value), EDIT_DEBOUNCE_MS),
      );
    },
    [send],
  );

  const commit = useCallback(
    async (name: string, value?: unknown) => {
      const v = value !== undefined ? value : typedRef.current[name];
      if (value !== undefined) setTyped(t => ({ ...t, [name]: value }));
      if (v === undefined) return { status: "idle" } as FieldOutcome;
      return send(name, v);
    },
    [send],
  );

  const reload = useCallback(
    (name: string) => {
      const current = outcomes[name]?.current;
      if (current) {
        queue.rebase(name, current.version);
        setServer(s => ({ ...s, [name]: current.value }));
      }
      setTyped(t => {
        const { [name]: _drop, ...rest } = t;
        void _drop;
        return rest;
      });
      setOutcomes(o => ({ ...o, [name]: { status: "idle" } }));
      if (!current) void query.refetch();
    },
    [outcomes, queue, query],
  );

  const overwrite = useCallback(
    async (name: string) => {
      const current = outcomes[name]?.current;
      if (current) {
        queue.rebase(name, current.version);
        setServer(s => ({ ...s, [name]: current.value }));
      }
      setOutcomes(o => ({ ...o, [name]: { status: "idle" } }));
      const v = typedRef.current[name];
      if (v === undefined) return;
      await queue.submit(name, v);
      refetchPending();
    },
    [outcomes, queue, refetchPending],
  );

  const field = useCallback(
    (name: string): FieldView => {
      const has = name in typed;
      return {
        value: has ? typed[name] : server[name],
        server: server[name],
        outcome: outcomes[name] ?? { status: "idle" },
        dirty: has || queue.busy(name),
      };
    },
    [typed, server, outcomes, queue],
  );

  const values = useMemo(() => ({ ...server, ...typed }), [server, typed]);

  const refresh = useCallback(async () => {
    await query.refetch();
    refetchPending();
  }, [query, refetchPending]);

  const noteReplyHash = useCallback((replyHash: string | undefined) => {
    if (!replyHash) return;
    // A reply made after the latest edit tells us the settings the test chatbot runs on now.
    if (!editedSinceReply.current) setHash(replyHash);
    editedSinceReply.current = false;
  }, []);

  const apply = useCallback(
    async (fields?: string[]): Promise<ApplyResult | null> => {
      if (!draftId) return null;
      setApplyState({ ...IDLE_APPLY, status: "applying" });
      try {
        const result = await applyMutation({ id: draftId, fields }).unwrap();
        const notApplied = Object.fromEntries(result.notApplied.map(n => [n.field, n.errorCode]));
        if (result.notApplied.some(n => n.errorCode === "credits_required")) setCreditsOut(true);
        setApplyState({
          status: "applied",
          notApplied,
          warnings: result.warnings ?? [],
        });
        void pendingQuery.refetch();
        return result;
      } catch (error) {
        const code = codeOf(error);
        const details = errorOf(error).data?.details;
        if (isCreditsRequired(error)) setCreditsOut(true);
        if (code === "not_live") {
          setApplyState({ ...IDLE_APPLY, status: "notLive" });
          void query.refetch();
        } else if (code === "safety_conflict" || errorOf(error).status === 422) {
          setApplyState({
            ...IDLE_APPLY,
            status: "conflict",
            reason: messageOf(error),
            field: (details?.field as string | null) ?? null,
          });
        } else if (code === "check_unavailable" || errorOf(error).status === 503) {
          setApplyState({ ...IDLE_APPLY, status: "unavailable" });
        } else {
          setApplyState({
            ...IDLE_APPLY,
            status: "failed",
            reason: messageOf(error),
            field: (details?.field as string | null) ?? null,
          });
        }
        return null;
      }
    },
    [draftId, applyMutation, pendingQuery, query],
  );

  const gone = errorOf(query.error).status === 404;

  return {
    wc,
    loading: query.isLoading,
    gone,
    failed: query.isError && !gone,
    live,
    settingsHash: hash,
    field,
    values,
    type,
    commit,
    reload,
    overwrite,
    hasPendingEdit: name => name in typed || queue.busy(name),
    refresh,
    noteReplyHash,
    pending: live ? (pendingQuery.data?.changes ?? []) : [],
    apply,
    applyState,
    creditsOut,
    markCreditsOut: () => setCreditsOut(true),
  };
};
