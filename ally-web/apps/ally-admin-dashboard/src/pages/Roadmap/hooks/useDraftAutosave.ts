import { useCallback, useEffect, useRef, useState } from "react";

import {
  useCreateRoadmapDraftMutation,
  useDiscardRoadmapDraftMutation,
  usePatchRoadmapDraftMutation,
} from "../../../api/roadmapV2Flow";
import {
  DeviceDraft,
  deviceDelete,
  deviceGet,
  deviceSet,
  isOfflineError,
} from "../utils/deviceStore";

import type { RoadmapDraftDetail } from "../../../types/roadmapV2Flow";

/** The key a draft has on the device before the server gives it a code. */
export const NEW_DRAFT_KEY = "new";
/** Quiet time before a change goes to the server (§4.2: "every change saves as you type"). */
export const AUTOSAVE_DELAY_MS = 800;
/** The server's limit on a draft's text. */
export const DRAFT_TEXT_MAX = 1000;

export type AutosaveState = "idle" | "saving" | "saved" | "device" | "error";

interface Options {
  /** The draft's code, or undefined on the New idea page until the first save creates it. */
  code?: string;
  /** The server's draft once loaded (undefined on New idea). */
  server?: RoadmapDraftDetail;
  /** Text to start a New idea with (the decline note's "New idea" pre-filled). */
  initialText?: string;
  captureMode?: "typed" | "voice";
  /** Read-only (archived): nothing saves. */
  readOnly?: boolean;
  /** The first save of a New idea made the draft: the page moves to its code. */
  onCreated?: (draft: RoadmapDraftDetail) => void;
}

/**
 * Autosave for the draft page (§4.2, §4.17). Every keystroke writes to the device first
 * (IndexedDB), then a quiet moment later to the server, so closing the page, a lift or a tunnel
 * loses nothing [FP-0959]. There is no Save button. Offline, the status says the words are on this
 * device, and they go up as soon as the browser is back online.
 *
 * The page's own text always wins over what the server answers: an autosave never moves the
 * caret. A version conflict (another tab) keeps this text and saves it over the other one.
 */
export const useDraftAutosave = ({
  code,
  server,
  initialText = "",
  captureMode = "typed",
  readOnly = false,
  onCreated,
}: Options) => {
  const [create] = useCreateRoadmapDraftMutation();
  const [patch] = usePatchRoadmapDraftMutation();
  const [discard] = useDiscardRoadmapDraftMutation();

  const key = code ?? NEW_DRAFT_KEY;
  const [text, setTextState] = useState<string>(server?.text ?? initialText);
  const [goalId, setGoalIdState] = useState<string | null>(server?.goal?.id ?? null);
  const [status, setStatus] = useState<AutosaveState>(server ? "saved" : "idle");
  const [savedAt, setSavedAt] = useState<number | null>(
    server?.savedAt ? new Date(server.savedAt).getTime() : null,
  );
  const [conflict, setConflict] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const versionRef = useRef<number | undefined>(server?.version);
  const latest = useRef({ text, goalId });
  latest.current = { text, goalId };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const creating = useRef(false);
  const codeRef = useRef(code);
  codeRef.current = code;
  /** Set once the first save of a New idea created the draft, before the page moves to it. */
  const createdCode = useRef<string | undefined>(undefined);
  const currentCode = () => codeRef.current ?? createdCode.current;

  // Take the server's text once it arrives, unless the device holds newer, unsynced words.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === key) return undefined;
    if (code && !server) return undefined;
    seededFor.current = key;
    let alive = true;
    void deviceGet<DeviceDraft>("drafts", key).then(local => {
      if (!alive) return;
      const serverAt = server?.savedAt ? new Date(server.savedAt).getTime() : 0;
      if (local && !local.synced && local.updatedAt > serverAt && !readOnly) {
        setTextState(local.text);
        setGoalIdState(local.goalId);
        dirty.current = true;
        setStatus("device");
        scheduleRef.current?.(0);
      } else if (server) {
        setTextState(server.text);
        setGoalIdState(server.goal?.id ?? null);
        versionRef.current = server.version;
      } else if (local && !local.synced && !initialText) {
        setTextState(local.text);
        setGoalIdState(local.goalId);
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [key, code, server, readOnly, initialText]);

  // The server version moves when the agent's turn or a reopen rewrites the draft.
  useEffect(() => {
    if (server?.version !== undefined && !dirty.current) versionRef.current = server.version;
  }, [server?.version]);

  const flush = useCallback(async (): Promise<void> => {
    if (readOnly || !dirty.current) return;
    if (inFlight.current) {
      await inFlight.current;
      if (!dirty.current) return;
    }
    const snapshot = { ...latest.current };
    let retryIn: number | null = null;
    let failed = false;
    const work = (async () => {
      dirty.current = false;
      setStatus("saving");
      try {
        if (!currentCode()) {
          const trimmed = snapshot.text.trim();
          if (!trimmed || creating.current) {
            setStatus("idle");
            return;
          }
          creating.current = true;
          const draft = await create({
            text: snapshot.text.slice(0, DRAFT_TEXT_MAX),
            ...(snapshot.goalId ? { goalId: snapshot.goalId } : {}),
            captureMode,
          }).unwrap();
          versionRef.current = draft.version;
          createdCode.current = draft.code;
          // Words typed while the draft was being made are the newest: keep them, unsynced.
          const now = latest.current;
          await deviceDelete("drafts", NEW_DRAFT_KEY);
          await deviceSet("drafts", draft.code, {
            code: draft.code,
            text: now.text,
            goalId: now.goalId,
            baseVersion: draft.version,
            updatedAt: Date.now(),
            synced: draft.text === now.text,
          } satisfies DeviceDraft);
          setSavedAt(Date.now());
          setStatus("saved");
          creating.current = false;
          if (draft.text !== latest.current.text) dirty.current = true;
          onCreated?.(draft);
          return;
        }
        const current = currentCode() as string;
        let result;
        try {
          result = await patch({
            code: current,
            patch: {
              text: snapshot.text,
              goalId: snapshot.goalId,
              ...(versionRef.current !== undefined ? { baseVersion: versionRef.current } : {}),
            },
          }).unwrap();
        } catch (error) {
          const data = (error as { data?: { code?: string } })?.data;
          if (data?.code !== "draft_version_conflict") throw error;
          // Another tab saved first. This page's words are what the person sees: keep them.
          setConflict(true);
          result = await patch({
            code: current,
            patch: { text: snapshot.text, goalId: snapshot.goalId },
          }).unwrap();
        }
        versionRef.current = result.version;
        const synced = !dirty.current;
        await deviceSet("drafts", current, {
          code: current,
          text: snapshot.text,
          goalId: snapshot.goalId,
          baseVersion: result.version,
          updatedAt: Date.now(),
          synced,
        } satisfies DeviceDraft);
        setSavedAt(Date.now());
        setStatus(dirty.current ? "saving" : "saved");
      } catch (error) {
        creating.current = false;
        dirty.current = true;
        failed = true;
        const offline = isOfflineError(error);
        setStatus(offline ? "device" : "error");
        // Offline waits for the browser's "online"; anything else tries again a little later.
        retryIn = offline && navigator.onLine === false ? null : AUTOSAVE_DELAY_MS * 6;
      }
    })();
    inFlight.current = work;
    await work;
    inFlight.current = null;
    if (retryIn !== null) scheduleRef.current?.(retryIn);
    else if (!failed && dirty.current && !timer.current) {
      scheduleRef.current?.(AUTOSAVE_DELAY_MS);
    }
  }, [readOnly, create, patch, captureMode, onCreated]);

  const scheduleRef = useRef<((delay: number) => void) | null>(null);
  scheduleRef.current = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, delay);
  };

  const write = useCallback(
    (nextText: string, nextGoal: string | null) => {
      if (readOnly) return;
      dirty.current = true;
      // The device first, at once: nothing typed is ever only in memory.
      void deviceSet("drafts", currentCode() ?? NEW_DRAFT_KEY, {
        code: currentCode() ?? NEW_DRAFT_KEY,
        text: nextText,
        goalId: nextGoal,
        baseVersion: versionRef.current,
        updatedAt: Date.now(),
        synced: false,
      } satisfies DeviceDraft);
      scheduleRef.current?.(AUTOSAVE_DELAY_MS);
    },
    [readOnly],
  );

  const setText = useCallback(
    (next: string) => {
      const clipped = next.slice(0, DRAFT_TEXT_MAX);
      setTextState(clipped);
      write(clipped, latest.current.goalId);
    },
    [write],
  );

  const setGoalId = useCallback(
    (next: string | null) => {
      setGoalIdState(next);
      write(latest.current.text, next);
    },
    [write],
  );

  // Back online: send what the device holds.
  useEffect(() => {
    const onOnline = () => {
      if (dirty.current) scheduleRef.current?.(0);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Leaving: save what's pending; a draft with no text yet is discarded (§4.2).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const { text: last } = latest.current;
      const current = currentCode();
      if (readOnly) return;
      if (current && !last.trim()) {
        void discard(current);
        void deviceDelete("drafts", current);
        return;
      }
      if (!current && !last.trim()) {
        void deviceDelete("drafts", NEW_DRAFT_KEY);
        return;
      }
      if (dirty.current) void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return {
    text,
    setText,
    goalId,
    setGoalId,
    status,
    savedAt,
    conflict,
    hydrated,
    /** Save now (before Check my idea or Submit, so the agent reads what's on screen). */
    flush,
    /** The server version the page's text is on. */
    version: () => versionRef.current,
    isDirty: () => dirty.current,
  };
};
