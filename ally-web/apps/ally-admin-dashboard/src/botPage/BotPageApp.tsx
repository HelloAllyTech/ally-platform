import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BotPageApiError, botPageApi } from "./api";
import { Turnstile } from "./components/Turnstile";
import { fill, pickCopy, type BotPageCopy } from "./copy";
import { AccessCode, AccessEmail } from "./screens/Access";
import { Chat, type ChatItem, type PendingReply } from "./screens/Chat";
import { Cover } from "./screens/Cover";
import { ErrorState } from "./screens/ErrorState";
import { Prechat } from "./screens/Prechat";
import { surfaceProps } from "./theme";

import type { PublicBotPage, PublicMessage, PublicSession } from "./types";

/** What loading the page found: the page, and where the visit picks up. */
interface Loaded {
  page?: PublicBotPage;
  stage: Stage;
  messages?: ChatItem[];
  signedInAs?: string | null;
}

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string; restart: boolean }
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
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const toItem = (m: PublicMessage): ChatItem => ({
  id: m.id,
  role: m.role,
  text: m.text,
  citations: m.citations,
  rateable: m.rateable,
});

/** A refusal or failure in the visitor's language. */
export function errorText(copy: BotPageCopy, error: unknown, page?: PublicBotPage | null): string {
  if (!(error instanceof BotPageApiError)) return copy.errors.INTERNAL;
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
 */
export function BotPageApp({ slug, api = botPageApi }: { slug: string; api?: typeof botPageApi }) {
  const [page, setPage] = useState<PublicBotPage | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingReply | null>(null);
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
          err.code === "BOT_PAGE_NOT_ALLOWED")
      ) {
        setStage({
          kind: "error",
          message: errorText(copy, err, page),
          restart: err.code !== "BOT_PAGE_NOT_FOUND",
        });
        return;
      }
      setError(errorText(copy, err, page));
    },
    [copy, page],
  );

  const openChat = useCallback(async () => {
    const { messages: stored } = await api.conversation(slug);
    setMessages(stored.filter(m => m.text.trim()).map(toItem));
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
  const load = useCallback(async (): Promise<Loaded> => {
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
          messages: resumed.messages.filter(m => m.text.trim()).map(toItem),
          signedInAs: session?.signedInAs ?? null,
        };
      }
    } catch {
      // No visitor yet, or no longer allowed: the cover starts a visit.
    }
    return { page: loaded, stage: { kind: "cover" } };
  }, [api, slug]);

  const apply = useCallback((result: Loaded) => {
    if (result.page) setPage(result.page);
    if (result.messages) setMessages(result.messages);
    if (result.signedInAs !== undefined) setSignedInAs(result.signedInAs);
    setStage(result.stage);
  }, []);

  useEffect(() => {
    let current = true;
    load().then(result => current && apply(result));
    return () => {
      current = false;
    };
  }, [load, apply]);

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

  if (!page || stage.kind === "loading") {
    if (stage.kind === "error") {
      return (
        <ErrorState
          copy={copy}
          message={stage.message}
          actionLabel={copy.errors.tryAgain}
          onAction={reload}
        />
      );
    }
    return (
      <p role="status" className="flex h-full items-center justify-center text-stone-500">
        {copy.loading}
      </p>
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

  const submitIntake = (answers: { id: string; value: string }[]) =>
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
    });

  const newChat = () =>
    run(async () => {
      abortRef.current?.abort();
      await api.newConversation(slug);
      setMessages([]);
      setPending(null);
    });

  const send = (text: string) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const local: ChatItem = { id: `local-${Date.now()}`, role: "user", text, citations: [] };
    setMessages(m => [...m, local]);
    setPending({ status: null, text: "" });
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
            onStatus: code => setPending(p => (p ? { ...p, status: code } : p)),
            onToken: piece => {
              target += piece;
            },
          },
          controller.signal,
        );
        await finishReveal();
        clearInterval(timer);
        setPending(null);
        setMessages(m => [
          ...m,
          {
            id: final.messageId,
            role: "assistant",
            text: final.reply,
            citations: final.citations,
            rateable: final.rateable,
          },
        ]);
      } catch (err) {
        clearInterval(timer);
        setPending(null);
        if (controller.signal.aborted) return;
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
        setBusy(false);
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
          onDone={answers => void submitIntake(answers)}
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
          pending={pending}
          onSend={send}
          onNewChat={() => void newChat()}
          busy={busy}
          error={error}
          signedInAs={signedInAs}
          returnedDraft={returnedDraft}
          onRate={(messageId, feedback) =>
            // A rating that doesn't reach us isn't worth an error on the visitor's screen.
            void api.feedback(slug, messageId, feedback).catch(() => undefined)
          }
        />
      );
  }

  return (
    <div {...surfaceProps(page.branding)} className="brand-surface bp-root">
      {screen}
    </div>
  );
}
