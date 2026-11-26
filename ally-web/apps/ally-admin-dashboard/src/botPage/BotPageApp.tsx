import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BotPageApiError, botPageApi } from "./api";
import { BLOCKED_CODES, blockedNotice } from "./blocked";
import { Turnstile } from "./components/Turnstile";
import { fill, pickCopy, type BotPageCopy } from "./copy";
import { bridge, type EmbedContext, type ToLoader } from "./embed";
import { useLiveSteps } from "./liveSteps";
import { AccessCode, AccessEmail } from "./screens/Access";
import { Chat, type ChatItem, type PendingReply } from "./screens/Chat";
import { Cover } from "./screens/Cover";
import { ErrorState } from "./screens/ErrorState";
import { Prechat } from "./screens/Prechat";
import { surfaceProps } from "./theme";
import { clearUnsent, dropUnsent, keepUnsent, withUnsent } from "./unsent";

import type { BlockedState, PublicBotPage, PublicMessage, PublicSession } from "./types";

/** What loading the page found: the page, and where the visit picks up. */
interface Loaded {
  page?: PublicBotPage;
  stage: Stage;
  messages?: ChatItem[];
  signedInAs?: string | null;
  knownName?: string | null;
}

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string; restart: boolean; final?: boolean }
  | { kind: "cover" }
  | { kind: "email" }
  | { kind: "code"; email: string }
  | { kind: "prechat" }
  | { kind: "chat" };

/** The reveal of a checked reply: about 65 characters a second, never longer than 4 s in all. */
const REVEAL_TICK_MS = 30;
const REVEAL_MAX_MS = 4000;
const MIN_CHARS_PER_TICK = 2;

const prefersReducedMotion = () =>
  // `?.matches`: a stubbed or partial matchMedia (tests, old embeds) can return nothing.
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

const toItem = (m: PublicMessage): ChatItem => ({
  id: m.id,
  role: m.role,
  text: m.text,
  citations: m.citations,
  rateable: m.rateable,
  ...(m.sender ? { sender: m.sender } : {}),
  // TF1 round 2 (Sahyog N-11): the card the reply showed, drawn again after a reload.
  ...(m.confirmation ? { confirmation: m.confirmation } : {}),
  ...(m.parts ? { parts: m.parts } : {}),
});

/** A send that didn't reach us or failed on our side: kept as not sent, with Send again (N-14). */
const notReached = (err: unknown): boolean =>
  !(err instanceof BotPageApiError) || err.status === 0 || err.status >= 500;

/** Waits between reconnects of the visitor stream, then 30 s (chunk 11a). */
const STREAM_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** A refusal or failure in the visitor's language. */
export function errorText(copy: BotPageCopy, error: unknown, page?: PublicBotPage | null): string {
  if (!(error instanceof BotPageApiError)) return copy.errors.INTERNAL;
  // TF1 F11: a paused or archived assistant's link shows its off message, which always carries
  // the crisis information, not a bare "isn't available".
  const off = error.details?.offMessage;
  if (typeof off === "string" && off.trim()) return off.trim();
  const text = copy.errors[error.code] ?? copy.errors.INTERNAL;
  return fill(text, {
    minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)),
    max: Number(error.details?.max ?? page?.maxMessageChars ?? 1000),
  });
}

/**
 * The bot page: a visitor's whole visit, from the cover to the chat (chunk 12b).
 *
 * The visitor is an httpOnly cookie ally-be sets, so this keeps no identity of its own: a reload
 * asks ally-be for the open conversation and carries on from there.
 *
 * With `embed`, it runs inside the website widget on the owner's site (chunk 13): no cover (the
 * bubble was the invitation), a Close button, and a word to the loader when a reply arrives while
 * the panel is shut. Everything else, access, safety and the team stepping in, is the same page.
 */
export function BotPageApp({
  slug,
  api = botPageApi,
  embed = null,
}: {
  slug: string;
  api?: typeof botPageApi;
  embed?: EmbedContext | null;
}) {
  const [page, setPage] = useState<PublicBotPage | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  // TF1 round 2 (Saathi B-2): the name the assistant keeps for them, with Remove.
  const [knownName, setKnownName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingReply | null>(null);
  // The assistant's live steps while it works (chunk 6b).
  const live = useLiveSteps();
  const [returnedDraft, setReturnedDraft] = useState<{ text: string } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const copy = useMemo(() => pickCopy(page?.language ?? "auto"), [page?.language]);

  useEffect(() => {
    document.documentElement.lang = copy.lang;
  }, [copy.lang]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const fail = useCallback(
    (err: unknown) => {
      if (
        err instanceof BotPageApiError &&
        (err.code === "BOT_PAGE_NOT_FOUND" ||
          err.code === "BOT_PAGE_START_AGAIN" ||
          err.code === "BOT_PAGE_NOT_ALLOWED" ||
          err.code === "BOT_PAGE_HOST_NOT_ALLOWED")
      ) {
        setStage({
          kind: "error",
          message: errorText(copy, err, page),
          restart: err.code !== "BOT_PAGE_NOT_FOUND" && err.code !== "BOT_PAGE_HOST_NOT_ALLOWED",
        });
        return;
      }
      setError(errorText(copy, err, page));
    },
    [copy, page],
  );

  const openChat = useCallback(async () => {
    const { messages: stored, name } = await api.conversation(slug);
    setMessages(withUnsent(slug, stored.filter(m => m.text.trim()).map(toItem), stored));
    setKnownName(name ?? null);
    setStage({ kind: "chat" });
  }, [api, slug]);

  const afterSession = useCallback(
    async (session: PublicSession, current: PublicBotPage) => {
      if (session.state === "needs_email") return setStage({ kind: "email" });
      if (session.state === "needs_code") return; // the caller moves to the code screen
      setSignedInAs(session.signedInAs);
      if (!session.intakeDone && current.prechat.length) return setStage({ kind: "prechat" });
      await openChat();
    },
    [openChat],
  );

  // Load the page, and carry on an open conversation after a reload.
  // By value, so a caller passing a new object each render doesn't reload the page.
  const embedHost = embed?.host ?? null;
  const embedPage = embed?.page ?? null;
  const framed = Boolean(embed);
  const load = useCallback(async (): Promise<Loaded> => {
    if (framed) {
      // Framed by a site the browser didn't name: refuse, never guess.
      if (!embedHost) {
        return {
          stage: {
            kind: "error",
            message: pickCopy("auto").errors.BOT_PAGE_HOST_NOT_ALLOWED,
            restart: false,
            final: true,
          },
        };
      }
      await api.startEmbed(slug, embedHost, embedPage);
    }
    let loaded: PublicBotPage;
    try {
      loaded = await api.page(slug);
    } catch (err) {
      return {
        stage: { kind: "error", message: errorText(pickCopy("auto"), err), restart: false },
      };
    }
    try {
      const resumed = await api.conversation(slug);
      if (resumed.messages.length) {
        const session = loaded.access !== "public" ? await api.session(slug) : null;
        return {
          page: loaded,
          stage: { kind: "chat" },
          messages: withUnsent(
            slug,
            resumed.messages.filter(m => m.text.trim()).map(toItem),
            resumed.messages,
          ),
          signedInAs: session?.signedInAs ?? null,
          knownName: resumed.name ?? null,
        };
      }
    } catch {
      // No visitor yet, or no longer allowed: the cover starts a visit.
    }
    return { page: loaded, stage: { kind: "cover" } };
  }, [api, slug, framed, embedHost, embedPage]);

  const apply = useCallback((result: Loaded) => {
    if (result.page) setPage(result.page);
    if (result.messages) setMessages(result.messages);
    if (result.signedInAs !== undefined) setSignedInAs(result.signedInAs);
    if (result.knownName !== undefined) setKnownName(result.knownName);
    setStage(result.stage);
  }, []);

  useEffect(() => {
    let current = true;
    load().then(result => current && apply(result));
    return () => {
      current = false;
    };
  }, [load, apply]);

  // ── The website widget (chunk 13) ─────────────────────────────────────
  const loader = useRef<{ post(message: ToLoader): void } | null>(null);
  const panelOpen = useRef(true);
  const unread = useRef(0);
  useEffect(() => {
    if (!embed?.host) return undefined;
    const link = bridge(embed.host, message => {
      panelOpen.current = message.type === "ally:opened";
      if (panelOpen.current) unread.current = 0;
    });
    loader.current = link;
    link.post({ type: "ally:ready" });
    return () => {
      link.stop();
      loader.current = null;
    };
  }, [embed?.host]);
  /** A reply came while the panel was shut: the bubble shows a dot. */
  const arrivedWhileClosed = useCallback(() => {
    if (panelOpen.current) return;
    unread.current += 1;
    loader.current?.post({ type: "ally:unread", count: unread.current });
  }, []);
  const closePanel = embed ? () => loader.current?.post({ type: "ally:close" }) : undefined;
  // No cover in the widget: the bubble was the invitation. A public page that needs the bot check
  // still shows it, since the check lives there.
  const startRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!embed || stage.kind !== "cover" || !page) return;
    if (page.access === "public" && page.turnstileSiteKey) return;
    startRef.current?.();
  }, [embed, stage.kind, page]);

  const reload = () => {
    setStage({ kind: "loading" });
    setError(null);
    void load().then(apply);
  };

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  // ── A person stepping in (chunk 11a) ──────────────────────────────────
  // The visitor stream: a team member's replies and changes of hands, live. Connects once there's a
  // chat (after the first message, or "Talk to a person"), and reconnects with backoff.
  const [streamKey, setStreamKey] = useState(0);
  const connectedTo = useRef<string | null>(null);
  useEffect(() => {
    if (stage.kind !== "chat") return undefined;
    let stopped = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      controller = new AbortController();
      let chat: string | null = null;
      try {
        await api.listen(
          slug,
          event => {
            if (event.type === "hello") {
              chat = event.conversationId;
              connectedTo.current = chat;
              attempt = 0;
              return;
            }
            if (event.type === "message") {
              arrivedWhileClosed();
              setMessages(list => {
                if (list.some(item => item.id === event.id)) return list;
                // TF1 round 2 (Saathi): the server stores one "A person from … has joined" notice
                // per take-over; the page adding its own line showed two.
                return [
                  ...list,
                  {
                    id: event.id,
                    role: event.role,
                    text: event.text,
                    citations: [],
                    ...(event.sender ? { sender: event.sender } : {}),
                  },
                ];
              });
            }
            if (event.type === "state" && event.by === "assistant") {
              setMessages(list => [
                ...list,
                {
                  id: `back-${Date.now()}`,
                  role: "notice",
                  text: copy.chat.backToAssistant,
                  citations: [],
                },
              ]);
            }
          },
          controller.signal,
        );
      } catch {
        // Dropped: try again below.
      }
      // No chat yet: the next message (or "Talk to a person") reconnects.
      if (stopped || !chat) {
        connectedTo.current = null;
        return;
      }
      const wait = STREAM_BACKOFF_MS[Math.min(attempt++, STREAM_BACKOFF_MS.length - 1)];
      retry = setTimeout(() => void run(), wait);
    };
    void run();
    return () => {
      stopped = true;
      clearTimeout(retry);
      controller?.abort();
    };
  }, [api, slug, stage.kind, streamKey, copy, arrivedWhileClosed]);

  if (!page || stage.kind === "loading") {
    // TF1 round 2: before the page loads (an off or paused link, a bad link) there is no
    // branding yet, but the screen still sits on the page's surface: its fonts, colours, sizes.
    if (stage.kind === "error") {
      return (
        <div className="brand-surface bp-root">
          <ErrorState
            copy={copy}
            message={stage.message}
            actionLabel={copy.errors.tryAgain}
            onAction={stage.final ? undefined : reload}
            crisis={page?.crisis}
          />
        </div>
      );
    }
    return (
      <div className="brand-surface bp-root">
        <p role="status" className="bp-screen bp-pad bp-muted" style={{ justifyContent: "center" }}>
          {copy.loading}
        </p>
      </div>
    );
  }

  const start = () =>
    run(async () => {
      const session = await api.session(
        slug,
        page.access === "public" && turnstileToken ? { turnstileToken } : {},
      );
      await afterSession(session, page);
    });
  startRef.current = () => void start();

  const sendCode = (email: string) =>
    run(async () => {
      await api.session(slug, { email });
      setStage({ kind: "code", email });
    });

  const verify = (email: string, code: string) =>
    run(async () => {
      const session = await api.verify(slug, email, code);
      await afterSession(session, page);
    });

  const submitIntake = (answers: { id: string; value: string }[], typed = "") =>
    run(async () => {
      setErrorField(null);
      try {
        await api.intake(slug, answers);
      } catch (err) {
        if (err instanceof BotPageApiError && err.code === "BOT_PAGE_INTAKE_INVALID") {
          setErrorField(String(err.details?.field ?? ""));
        }
        throw err;
      }
      await openChat();
      // A message typed beside the questions goes into the chat box, ready to send.
      if (typed.trim()) setReturnedDraft({ text: typed.trim() });
    });

  const newChat = () =>
    run(async () => {
      // TF1 round 2: New chat works while a reply is pending: the stream stops, its pending reply
      // goes, and nothing from it lands in the new chat.
      abortRef.current?.abort();
      abortRef.current = null;
      live.stop();
      setPending(null);
      setReturnedDraft(null);
      await api.newConversation(slug);
      clearUnsent(slug);
      setMessages([]);
      setPending(null);
    });

  const askForPerson = () =>
    void (async () => {
      setError(null);
      try {
        const result = await api.askForPerson(slug);
        setMessages(m => [
          ...m,
          { id: result.messageId, role: "assistant", text: result.reply, citations: [] },
        ]);
        if (connectedTo.current !== result.conversationId) setStreamKey(k => k + 1);
      } catch (err) {
        fail(err);
      }
    })();

  const send = (text: string, action?: string) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const local: ChatItem = { id: `local-${Date.now()}`, role: "user", text, citations: [] };
    // The same words sent again replace their unsent copy (N-14).
    const same = (t: string) => t.trim() === text.trim();
    dropUnsent(slug, m => same(m.text));
    setMessages(m => [...m.filter(item => !(item.unsent && same(item.text))), local]);
    setPending({ status: null, text: "" });
    live.start();
    setReturnedDraft(null);

    // Tokens arrive in one burst once the checks clear; they are revealed at reading pace.
    let target = "";
    let shown = 0;
    let revealStarted = 0;
    const timer = setInterval(() => {
      if (shown >= target.length) return;
      if (!revealStarted) revealStarted = Date.now();
      const left = target.length - shown;
      const ticksLeft = Math.max(
        1,
        Math.floor((REVEAL_MAX_MS - (Date.now() - revealStarted)) / REVEAL_TICK_MS),
      );
      shown = prefersReducedMotion()
        ? target.length
        : Math.min(
            target.length,
            shown + Math.max(MIN_CHARS_PER_TICK, Math.ceil(left / ticksLeft)),
          );
      setPending(p => (p ? { ...p, text: target.slice(0, shown) } : p));
    }, REVEAL_TICK_MS);
    // Leaving the page (or a newer message) aborts this send: its reveal stops with it, so the
    // timer never writes state after unmount.
    controller.signal.addEventListener("abort", () => clearInterval(timer));
    /** Let the reveal catch up before the stored reply replaces it (at most 4 s). */
    const finishReveal = async () => {
      const deadline = Date.now() + REVEAL_MAX_MS;
      while (shown < target.length && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, REVEAL_TICK_MS));
      }
    };

    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const final = await api.send(
          slug,
          text,
          {
            onStatus: code => {
              // A draft sent back to be rewritten (chunk H1): its streamed text goes.
              // TF1 round 2: the draft leaves the screen now, not when the rewrite starts
              // streaming; a frozen draft followed by a new one read as the reply sent twice.
              if (code === "rewriting") {
                target = "";
                shown = 0;
                revealStarted = 0;
                setPending(p => (p ? { ...p, status: code, text: "" } : p));
                return;
              }
              setPending(p => (p ? { ...p, status: code } : p));
            },
            onToken: piece => {
              target += piece;
            },
            onActivity: step => live.push(step),
          },
          controller.signal,
          action,
        );
        await finishReveal();
        clearInterval(timer);
        // Stopped by New chat (or a newer message) while the reveal ran: that reply is gone.
        if (controller.signal.aborted) return;
        live.stop();
        setPending(null);
        if (connectedTo.current !== final.conversationId) setStreamKey(k => k + 1);
        // A team member has this chat: no reply now; theirs arrives on the visitor stream.
        if (final.held) return;
        if (final.blocked) {
          // The fixed notification: shown as the reply, never rateable, no model behind it.
          setMessages(m => [
            ...m,
            {
              id: final.messageId || `blocked-${Date.now()}`,
              role: "assistant",
              text: blockedNotice(copy, final.blocked as BlockedState, page, final.reply),
              citations: [],
              rateable: false,
            },
          ]);
          return;
        }
        if (final.name) setKnownName(final.name);
        setMessages(m => [
          ...m,
          {
            id: final.messageId,
            role: "assistant",
            // The checked reply takes the streamed bubble's place: it doesn't rise in as a new one.
            ...(shown > 0 ? { inPlace: true } : {}),
            text: final.reply,
            citations: final.citations,
            rateable: final.rateable,
            steps: final.steps,
            confirmation: final.confirmation,
            parts: final.parts,
          },
        ]);
      } catch (err) {
        clearInterval(timer);
        // Aborted: the page has gone, or a newer message took over and owns the reply area
        // (stopping its steps or clearing its pending reply would undo that one).
        if (controller.signal.aborted) return;
        // A failed run ends its steps quietly; the error, if any, is the page's usual one.
        live.stop();
        setPending(null);
        const blockedState = err instanceof BotPageApiError ? BLOCKED_CODES[err.code] : undefined;
        if (blockedState) {
          setMessages(m => [
            ...m,
            {
              id: `blocked-${Date.now()}`,
              role: "assistant",
              text: blockedNotice(copy, blockedState, page),
              citations: [],
              rateable: false,
            },
          ]);
          return;
        }
        if (notReached(err)) {
          // TF1 round 2 (Sahyog N-14): offline, or the server down: the message stays, marked not
          // sent, with Send again, and its words go back in the box. Kept for a reload too.
          const unsent = action ? { action } : {};
          setMessages(m => m.map(item => (item.id === local.id ? { ...item, unsent } : item)));
          keepUnsent(slug, { id: local.id, text, ...unsent, at: Date.now() });
          if (!action) setReturnedDraft({ text });
          fail(err);
          return;
        }
        if (err instanceof BotPageApiError && err.status > 0) {
          // An HTTP refusal comes before anything is stored, so the message goes back in the box.
          setMessages(m => m.filter(item => item.id !== local.id));
          setReturnedDraft({ text });
        }
        if (err instanceof BotPageApiError && err.code === "BOT_PAGE_INTAKE_REQUIRED") {
          setStage({ kind: "prechat" });
          return;
        }
        fail(err);
      } finally {
        // An aborted send leaves busy to what aborted it (New chat's own run, or the next send).
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
  };

  let screen: React.ReactNode;
  switch (stage.kind) {
    case "error":
      screen = (
        <ErrorState
          copy={copy}
          message={stage.message}
          actionLabel={copy.errors.startAgain}
          onAction={stage.restart ? reload : undefined}
          crisis={page?.crisis}
        />
      );
      break;
    case "cover":
      screen = (
        <Cover
          page={page}
          copy={copy}
          onStart={() => void start()}
          busy={
            busy || (page.access === "public" && Boolean(page.turnstileSiteKey) && !turnstileToken)
          }
          error={error}
          turnstile={
            page.access === "public" && page.turnstileSiteKey ? (
              <Turnstile siteKey={page.turnstileSiteKey} onToken={setTurnstileToken} />
            ) : null
          }
        />
      );
      break;
    case "email":
      screen = (
        <AccessEmail
          branding={page.branding}
          copy={copy}
          crisis={page.crisis}
          onSubmit={email => void sendCode(email)}
          busy={busy}
          error={error}
        />
      );
      break;
    case "code":
      screen = (
        <AccessCode
          branding={page.branding}
          copy={copy}
          email={stage.email}
          crisis={page.crisis}
          onSubmit={code => void verify(stage.email, code)}
          onResend={() => void sendCode(stage.email)}
          onChangeEmail={() => {
            setError(null);
            setStage({ kind: "email" });
          }}
          busy={busy}
          error={error}
        />
      );
      break;
    case "prechat":
      screen = (
        <Prechat
          branding={page.branding}
          copy={copy}
          fields={page.prechat}
          onDone={(answers, typed) => void submitIntake(answers, typed)}
          notice={page.notice}
          disclaimer={page.disclaimer}
          draft={returnedDraft?.text}
          maxChars={page.maxMessageChars}
          onSendMessage={text => {
            // The questions never block a first message: go to the chat and send it. If the server
            // asks for the answers, the catch below brings the questions back with the text kept.
            setStage({ kind: "chat" });
            send(text);
          }}
          busy={busy}
          error={error}
          errorField={errorField}
        />
      );
      break;
    default:
      screen = (
        <Chat
          page={page}
          copy={copy}
          messages={messages}
          pending={pending ? { ...pending, step: live.current, slow: live.slow } : null}
          onSend={text => send(text)}
          onTap={button => send(button.label, button.token)}
          onResend={item => {
            dropUnsent(slug, m => m.id === item.id);
            setMessages(m => m.filter(x => x.id !== item.id));
            send(item.text, item.unsent?.action);
          }}
          onNewChat={() => void newChat()}
          busy={busy}
          error={error}
          signedInAs={signedInAs}
          knownName={knownName}
          onForgetName={() =>
            void api
              .forgetName(slug)
              .then(() => setKnownName(null))
              .catch(() => undefined)
          }
          returnedDraft={returnedDraft}
          onAskPerson={askForPerson}
          onClose={closePanel}
          onRate={(messageId, feedback) =>
            // A rating that doesn't reach us isn't worth an error on the visitor's screen.
            void api.feedback(slug, messageId, feedback).catch(() => undefined)
          }
        />
      );
  }

  return (
    <div
      {...surfaceProps(page.branding)}
      className={`brand-surface bp-root${embed ? " bp-root--embed" : ""}`}
    >
      {/* In the widget, every screen but the chat (whose header has it) gets a way to close. */}
      {closePanel && stage.kind !== "chat" && (
        <button type="button" className="bp-close bp-close--float" onClick={closePanel}>
          <span aria-hidden="true">×</span>
          <span className="ally-sr-only">{copy.embed.close}</span>
        </button>
      )}
      {screen}
    </div>
  );
}
