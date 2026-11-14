import { useCallback, useEffect, useRef, useState } from "react";

import { useLazyGetBotDraftQuery } from "@api";
import { ApiEndpoints, HttpMethod } from "@constants";
import { fetchWithReauth } from "@hooks/chatStream/fetchWithReauth";
import { readSse } from "@hooks/chatStream/sse";

import { COPY } from "./copy";
import { withFinding } from "./findings";

import type { BotDraftView, TranscriptEntry } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const url = (path: string) => `${API_BASE_URL}/api${path}`;

/** Wait before reconnecting the canvas stream after it drops. */
const RECONNECT_MS = 2000;
/** Bursts of canvas events collapse into one reload of the draft. */
const RELOAD_DEBOUNCE_MS = 300;

/** What the website read has shown so far, live (copy §3). */
export interface ReadingProgress {
  domain: string | null;
  read: number;
  findings: string[];
  done: { n: number; seconds: number } | null;
  startedAt: number | null;
}

export interface BotDraftSession {
  view: BotDraftView | null;
  reading: ReadingProgress;
  /** What the builder is doing now (copy §15), while a turn runs. */
  working: string | null;
  /** The builder's reply so far, revealed as it streams. */
  streaming: string;
  sending: boolean;
  error: string | null;
  /** Bumped whenever the canvas changed, for the phone tab's badge. */
  canvasVersion: number;
  /** `shown` is how the owner's choice reads in the chat (a design's title), if not its text. */
  send: (input: { text?: string; chip?: string }, shown?: string) => Promise<void>;
  /** Cancel the builder's reply: the draft stays exactly as it was before the message. */
  stop: () => void;
  reload: () => Promise<void>;
  setView: (view: BotDraftView) => void;
}

const emptyReading = (view?: BotDraftView | null): ReadingProgress => ({
  domain: view?.crawl.domain ?? null,
  read: view?.crawl.pagesRead ?? 0,
  findings: [],
  done: null,
  startedAt: view?.crawl.startedAt ? Date.parse(view.crawl.startedAt) : null,
});

/**
 * One onboarding session: the draft, its live canvas events (`/events`) and the builder
 * conversation (`/messages/stream`), reduced into one state. The canvas stream reconnects on its
 * own, and a reconnect starts with the whole draft, so nothing is missed while it was down.
 */
export const useBotDraftSession = (draftId: string): BotDraftSession => {
  const [view, setViewState] = useState<BotDraftView | null>(null);
  const [reading, setReading] = useState<ReadingProgress>(emptyReading());
  const [working, setWorking] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [loadDraft] = useLazyGetBotDraftQuery();
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>();
  const turnAbort = useRef<AbortController | null>(null);

  const setView = useCallback((next: BotDraftView) => {
    setViewState(previous =>
      previous && previous.version > next.version && previous.id === next.id ? previous : next,
    );
    setCanvasVersion(v => v + 1);
  }, []);

  const reload = useCallback(async () => {
    const result = await loadDraft(draftId)
      .unwrap()
      .catch(() => null);
    if (result) setView(result);
  }, [draftId, loadDraft, setView]);

  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
  }, [reload]);

  const appendEntry = useCallback((entry: TranscriptEntry) => {
    setViewState(previous =>
      !previous || previous.transcript.some(e => e.id === entry.id)
        ? previous
        : { ...previous, transcript: [...previous.transcript, entry] },
    );
  }, []);

  // The canvas stream: crawl progress, findings, and every change to the draft.
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetchWithReauth(
          url(ApiEndpoints.BOT_DRAFTS.EVENTS(draftId)),
          undefined,
          controller.signal,
          HttpMethod.GET,
        );
        if (!response.ok || !response.body) throw new Error(String(response.status));
        await readSse(response.body, ({ type, data }) => {
          const event = data as Record<string, unknown>;
          switch (type) {
            case "state": {
              const state = data as BotDraftView;
              setView(state);
              setReading(previous => ({ ...emptyReading(state), findings: previous.findings }));
              break;
            }
            case "reading":
              setReading(previous => ({
                ...previous,
                domain: (event.domain as string) ?? previous.domain,
                startedAt: previous.startedAt ?? Date.now(),
              }));
              break;
            case "page":
              setReading(previous => ({ ...previous, read: Number(event.n) || previous.read }));
              break;
            case "finding": {
              const line =
                event.kind === "brand"
                  ? COPY.reading.brand
                  : typeof event.text === "string"
                    ? event.text
                    : null;
              if (line) {
                setReading(previous => ({
                  ...previous,
                  findings: withFinding(previous.findings, line),
                }));
                setCanvasVersion(v => v + 1);
              }
              break;
            }
            case "brand":
              setReading(previous => ({
                ...previous,
                findings: withFinding(previous.findings, COPY.reading.brand),
              }));
              scheduleReload();
              break;
            case "done":
              setReading(previous => ({
                ...previous,
                read: Number(event.n) || previous.read,
                done: { n: Number(event.n) || 0, seconds: Number(event.seconds) || 0 },
              }));
              scheduleReload();
              break;
            case "message":
              appendEntry(event.entry as TranscriptEntry);
              break;
            default:
              // patched, step, safety, draft, published: the draft changed.
              scheduleReload();
          }
        });
      } catch {
        // Dropped or refused: try again below.
      }
      if (!stopped) retry = setTimeout(() => void connect(), RECONNECT_MS);
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(reloadTimer.current);
      controller?.abort();
    };
  }, [draftId, appendEntry, scheduleReload, setView]);

  useEffect(() => () => turnAbort.current?.abort(), []);

  const stop = useCallback(() => turnAbort.current?.abort(), []);

  const send = useCallback(
    async (input: { text?: string; chip?: string }, label?: string) => {
      if (sending) return;
      const shown = label ?? input.text ?? input.chip ?? "";
      const pendingId = `pending-${Date.now()}`;
      appendEntry({ id: pendingId, role: "owner", text: shown, at: new Date().toISOString() });
      setSending(true);
      setError(null);
      setStreaming("");
      setWorking(COPY.working.thinking);
      const controller = new AbortController();
      turnAbort.current = controller;
      try {
        const response = await fetchWithReauth(
          url(ApiEndpoints.BOT_DRAFTS.MESSAGES_STREAM(draftId)),
          input,
          controller.signal,
        );
        if (!response.ok || !response.body) throw new Error(String(response.status));
        let finished = false;
        await readSse(response.body, ({ type, data }) => {
          const event = data as Record<string, unknown>;
          if (type === "status") {
            setWorking(COPY.working[String(event.code)] ?? COPY.working.thinking);
          } else if (type === "message") {
            appendEntry(event as unknown as TranscriptEntry);
          } else if (type === "token") {
            setStreaming(previous => previous + String(event.text ?? ""));
          } else if (type === "final") {
            finished = true;
            setView(event.draft as BotDraftView);
            return true;
          } else if (type === "error") {
            throw new Error(String(event.code));
          }
          return false;
        });
        if (!finished) throw new Error("no reply");
      } catch {
        if (!controller.signal.aborted) {
          setError(COPY.problems.generic);
          // Whatever the server kept (the owner's message, at least) comes back with the draft.
          void reload();
        }
      } finally {
        setViewState(previous =>
          previous
            ? { ...previous, transcript: previous.transcript.filter(e => e.id !== pendingId) }
            : previous,
        );
        setSending(false);
        setWorking(null);
        setStreaming("");
      }
    },
    [appendEntry, draftId, reload, sending, setView],
  );

  return {
    view,
    reading,
    working,
    streaming,
    sending,
    error,
    canvasVersion,
    send,
    stop,
    reload,
    setView,
  };
};
