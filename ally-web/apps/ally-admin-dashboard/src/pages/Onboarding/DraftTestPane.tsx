import React, { useCallback, useEffect, useRef, useState } from "react";

import { useTestBotDraftMutation } from "@api";
import type { DraftTestResponse, LikelyResult } from "@api";
import { Button, Chip, Orb, Segmented } from "@components/v2";
import { ApiEndpoints } from "@constants";
import { ChatbotTestStreamUnavailable, useChatbotTestStream } from "@hooks/useChatbotTestStream";

import { SPLIT_COPY, fill } from "./copy";
import { BUILD_COPY } from "./create/copy";
import { AddFactBox, FixPanel, SaveAsTest } from "./FixThis";
import { LikelyQuestions } from "./LikelyQuestions";
import { PERSONA_SCRIPTS } from "./personaScripts";
import { ConfirmationCard, ReplyPartsView, TestOnly } from "../../botPage/components/parts";
import { pickCopy } from "../../botPage/copy";

import type { FixTools } from "./FixThis";
import type { PersonaScript } from "./personaScripts";
import type { SplitBridge } from "./splitBridge";
import type { BotDraftView } from "./types";
import type { PublicConfirmation, ReplyParts } from "../../botPage/types";

import "./draftTest.css";
import "../../botPage/page.css";

/** The bot page's words for its cards (BT1), in English: the owner's test pane. */
const pageCopy = pickCopy("en", "en");

const T = SPLIT_COPY.pane;
const T_FIX = SPLIT_COPY.fix;
const T_UNANSWERED = SPLIT_COPY.unanswered;
const T_TRY = SPLIT_COPY.tryAs;
const T_LIKELY = SPLIT_COPY.likely;
const T_CHANNEL = SPLIT_COPY.channel;

type Channel = "page" | "whatsapp" | "widget";
const CHANNELS: { id: Channel; label: string }[] = [
  { id: "page", label: T_CHANNEL.page },
  { id: "whatsapp", label: T_CHANNEL.whatsapp },
  { id: "widget", label: T_CHANNEL.widget },
];

/** Mirrors ally-be CRAWL_LIMITS.maxPages: the most pages one site read will learn. */
export const CRAWL_MAX_PAGES = 50;
/** The progress line changes at most this often while the read runs (finishing is immediate). */
export const PROGRESS_THROTTLE_MS = 3000;
/** The test endpoints accept at most 20 earlier messages. */
const MAX_HISTORY = 20;

type StatusCode = keyof typeof T.status;
const isStatus = (code: string): code is StatusCode => code in T.status;

interface Why {
  passages: { title: string; section: string | null }[];
  ms: number | null;
  declined: boolean;
}

type Item =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      /** The draft's `version` when the question was sent: the settings this reply came from. */
      version: number;
      /** Stage 3: the settings hash the server made this reply with (replaces `version` when given). */
      hash?: string;
      /** The blank chatbot's canned starter reply (no model call). */
      starter?: boolean;
      /** A live chatbot's test: it used the working copy, which customers don't get yet. */
      workingCopy?: boolean;
      /** Null for a reply opened from the likely questions: nothing is known about how it was made. */
      why: Why | null;
      pendingDocuments: number;
      /** An edit to the owner's notes or facts was still being indexed when this reply was made. */
      editsSearchable: boolean;
      /** Asked again after an edit: kept above the new reply, faded. */
      faded: boolean;
      /** The question this reply answers. */
      question: string;
      /** It said it didn't know and would file the question as unanswered. */
      unanswered: boolean;
      /** Asked again straight after a fix from this pane. */
      afterFix: boolean;
      /** BT1: chips and cards, as on the bot page (taps are test-only here). */
      parts?: ReplyParts;
      /** BT1: a Confirm tap's done card, marked "Test only, not saved". */
      confirmation?: PublicConfirmation & { testOnly?: string };
    }
  | { kind: "note"; id: string }
  | { kind: "info"; id: string; text: string };

interface Pending {
  status: StatusCode;
  text: string;
}

const whyOf = (result: DraftTestResponse): Why => ({
  passages: result.citations.map(c => ({
    title: c.document_title,
    section: c.section_path || null,
  })),
  ms: typeof result.latencyMs === "number" ? result.latencyMs : null,
  declined: String(result.handledBy) === "declined",
});

/** The messages before the last question, newest 20: what a repeated question is sent after. */
const historyOf = (items: Item[], beforeLastQuestion: boolean) => {
  let list = items;
  if (beforeLastQuestion) {
    let last = -1;
    items.forEach((item, n) => {
      if (item.kind === "user") last = n;
    });
    list = last < 0 ? [] : items.slice(0, last);
  }
  return list
    .filter(
      (item): item is Extract<Item, { kind: "user" | "assistant" }> =>
        (item.kind === "user" || item.kind === "assistant") &&
        !(item.kind === "assistant" && item.faded),
    )
    .slice(-MAX_HISTORY)
    .map(item => ({ role: item.kind, content: item.text }));
};

/** The questions whose latest reply couldn't be answered, oldest first, with that reply's id. */
const unansweredOf = (items: Item[]): { question: string; id: string }[] => {
  const latest = new Map<string, { id: string; unanswered: boolean }>();
  items.forEach(item => {
    if (item.kind === "assistant") {
      latest.delete(item.question);
      latest.set(item.question, { id: item.id, unanswered: item.unanswered });
    }
  });
  return [...latest.entries()]
    .filter(([, v]) => v.unanswered)
    .map(([question, v]) => ({ question, id: v.id }));
};

const creditsStatus = (error: unknown): boolean => {
  const e = error as { status?: number; data?: { errorCode?: string } } | undefined;
  return e?.status === 402 || e?.data?.errorCode === "credits_required";
};

const finishedStatus = (error: unknown): boolean => {
  const e = error as { status?: number; data?: { errorCode?: string } } | undefined;
  return e?.status === 409 || e?.data?.errorCode === "setup_finished";
};

/** `value`, but while `running` it moves at most once per `PROGRESS_THROTTLE_MS`; stopping is immediate. */
const useThrottled = (value: number, running: boolean): number => {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (!running) return undefined;
    // Never set state synchronously here: even an immediate update goes through a timer.
    const wait = Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - last.current));
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, running]);
  // Stopping is immediate: the final value shows at once, whatever was last shown while running.
  return running ? shown : value;
};

const CrawlProgress: React.FC<{ view: BotDraftView }> = ({ view }) => {
  const crawl = view.crawl;
  const running = crawl?.status === "running";
  const n = useThrottled(crawl?.pagesRead ?? 0, running);
  let line = "";
  if (running) line = fill(T.progress.running, { n, max: CRAWL_MAX_PAGES });
  else if (n > 0 && (crawl?.status === "done" || crawl?.status === "partial"))
    line = fill(T.progress.done, { n });
  return (
    <p
      className="ally-small ally-dt__progress"
      data-testid="draft-crawl-progress"
      aria-live="polite"
    >
      {line}
    </p>
  );
};

const ReplyDetails: React.FC<{ why: Why }> = ({ why }) => (
  <details className="ally-dt__why">
    <summary>{T.why.toggle}</summary>
    <div className="ally-small">
      {why.declined && <p>{T.why.declined}</p>}
      {why.passages.length ? (
        <>
          <p className="ally-field__label">{T.why.passages}</p>
          <ul>
            {why.passages.map((p, n) => (
              <li key={n}>{p.section ? `${p.title} · ${p.section}` : p.title}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>{T.why.none}</p>
      )}
      {why.ms !== null && <p>{fill(T.why.time, { s: (why.ms / 1000).toFixed(1) })}</p>}
    </div>
  </details>
);

/**
 * The right half of split build: chat with the draft's real assistant while it is built. Each
 * question goes to the draft's test route, which tests the latest saved draft, so an edit is live
 * for the next message. Replies remember the draft version they came from; when the draft moves on
 * the pane says so once and offers to ask the last question again.
 */
export const DraftTestPane: React.FC<{
  draftId: string;
  view: BotDraftView;
  /** Ways to change the draft from the chat (Fix this, Add a fact). Off when absent. */
  fix?: FixTools;
  /** Tells the build half what it couldn't answer, and lets it open that list. Off when absent. */
  bridge?: SplitBridge;
  /**
   * Stage 3: the working copy's settings hash. When given it replaces the draft's `version` as the
   * "older settings" marker: a reply is older when its `preview.settingsHash` differs.
   */
  settingsHash?: string;
  /** Stage 3: whether the test chatbot can be used (the working copy exists, not archived). */
  usable?: boolean;
  /** Shown instead of the default placeholder when not usable. */
  placeholder?: string;
  /** Stage 3: AI is off ($0): the reason, shown instead of the input. */
  aiOff?: string | null;
  /** A reply's settings hash, so the screen knows what the test chatbot runs on. */
  onReplyHash?: (hash: string | undefined) => void;
  /** A test was refused with 402 `credits_required`. */
  onCreditsRequired?: () => void;
}> = ({
  draftId,
  view,
  fix,
  bridge,
  settingsHash,
  usable: usableProp,
  placeholder,
  aiOff,
  onReplyHash,
  onCreditsRequired,
}) => {
  const stream = useChatbotTestStream(ApiEndpoints.BOT_DRAFTS.TEST_STREAM);
  const [test] = useTestBotDraftMutation();
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [text, setText] = useState("");
  const [announce, setAnnounce] = useState({ n: 0, text: "" });
  const conversation = useRef<string | undefined>();
  const counter = useRef(0);
  const run = useRef(0);
  const versionRef = useRef(view.version);
  const itemsRef = useRef(items);
  // Kept current after each render, ahead of the effects below that read them.
  useEffect(() => {
    versionRef.current = view.version;
    itemsRef.current = items;
  });
  const scroller = useRef<HTMLDivElement>(null);
  const afterFixRef = useRef(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("page");
  const [menuOpen, setMenuOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const persona = useRef(0);
  const [likelyRun, setLikelyRun] = useState(0);
  const [likelyBusy, setLikelyBusy] = useState(false);
  const unanswered = fix ? unansweredOf(items) : [];
  const shownCount = useThrottled(unanswered.length, true);

  const unansweredCount = unanswered.length;
  useEffect(() => {
    bridge?.setUnanswered(unansweredCount);
    return () => bridge?.setUnanswered(0);
  }, [bridge, unansweredCount]);
  useEffect(() => {
    bridge?.setOpener(() => setListOpen(true));
    return () => bridge?.setOpener(null);
  }, [bridge]);

  const usable = usableProp ?? (Boolean(view.chatbotId) && view.status === "active");
  /** A reply made on settings the chatbot has moved on from. */
  const olderThanNow = (item: { version: number; hash?: string }) =>
    settingsHash !== undefined
      ? Boolean(item.hash) && item.hash !== settingsHash
      : item.version !== view.version;
  const nextId = (prefix: string) => `${prefix}${(counter.current += 1)}`;

  // The draft moved on since the last reply: say so once, however many edits landed.
  useEffect(() => {
    if (pending) return;
    const list = itemsRef.current;
    let at = -1;
    list.forEach((item, n) => {
      if (item.kind === "assistant") at = n;
    });
    if (at < 0) return;
    const reply = list[at] as Extract<Item, { kind: "assistant" }>;
    if (!olderThanNow(reply)) return;
    // One note per reply, however many edits landed since.
    if (list.slice(at).some(item => item.kind === "note")) return;
    setItems(prev => [...prev, { kind: "note", id: nextId("n") }]);
    setAnnounce(a => ({ n: a.n + 1, text: T.announce }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.version, settingsHash, items.length, pending]);

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [items.length, pending?.text]);

  const send = useCallback(
    async (
      question: string,
      mode: "new" | "again" | "retry",
      /** BT1: a tap's token; `question` is then the label tapped. */
      action?: string,
    ): Promise<boolean> => {
      const current = itemsRef.current;
      const history = historyOf(current, mode !== "new");
      const version = versionRef.current;
      const token = (run.current += 1);
      const afterFix = afterFixRef.current;
      afterFixRef.current = false;
      if (mode === "new") {
        setItems(list => [...list, { kind: "user", id: nextId("u"), text: question }]);
      } else if (mode === "again") {
        setItems(list => {
          let at = -1;
          list.forEach((item, n) => {
            if (item.kind === "assistant") at = n;
          });
          return list.map((item, n) =>
            n === at && item.kind === "assistant" ? { ...item, faded: true } : item,
          );
        });
      }
      setPending({ status: "thinking", text: "" });
      setFailed(null);
      const request = {
        id: draftId,
        message: question,
        history,
        conversationId: conversation.current,
        ...(action ? { action } : {}),
      };
      let arrived = "";
      try {
        let result: DraftTestResponse;
        try {
          result = await stream.run(request, {
            onStatus: status => {
              if (status.code === "rewriting") arrived = "";
              setPending(
                p =>
                  p && {
                    text: status.code === "rewriting" ? "" : p.text,
                    status: isStatus(status.code) ? status.code : p.status,
                  },
              );
            },
            onStep: () => undefined,
            onToken: piece => {
              arrived += piece;
              setPending(p => p && { ...p, text: arrived });
            },
          });
        } catch (error) {
          if (!(error instanceof ChatbotTestStreamUnavailable)) throw error;
          if (error.status === 409) throw error;
          result = await test(request).unwrap();
        }
        if (token !== run.current) return false;
        conversation.current = result.conversationId;
        onReplyHash?.(result.preview?.settingsHash);
        setItems(list => [
          ...list,
          {
            kind: "assistant",
            id: nextId("a"),
            text: result.reply,
            version,
            hash: result.preview?.settingsHash,
            starter: Boolean(result.preview?.starter),
            workingCopy: Boolean(result.preview?.workingCopy),
            why: whyOf(result),
            pendingDocuments: result.preview?.pendingDocuments ?? 0,
            editsSearchable: result.preview?.editsSearchable ?? true,
            faded: false,
            question,
            unanswered:
              String(result.handledBy) === "declined" && result.wouldFileUnanswered != null,
            afterFix,
            ...(result.parts ? { parts: result.parts } : {}),
            ...(result.confirmation ? { confirmation: result.confirmation } : {}),
          },
        ]);
        return true;
      } catch (error) {
        if (token !== run.current) return false;
        if (
          (error instanceof ChatbotTestStreamUnavailable && error.status === 402) ||
          creditsStatus(error)
        ) {
          onCreditsRequired?.();
          setFailed(null);
        } else if (error instanceof ChatbotTestStreamUnavailable && error.status === 409) {
          setFinished(true);
        } else if (finishedStatus(error)) {
          setFinished(true);
        } else {
          setFailed(question);
        }
        return false;
      } finally {
        if (token === run.current) setPending(null);
      }
    },

    [draftId, stream, test, onReplyHash, onCreditsRequired],
  );

  /** After a change that landed: close the panel, say so, and ask the same question once more. */
  const reask = (question: string, replyId: string) => {
    setFixing(null);
    setItems(list => [...list, { kind: "info", id: nextId("i"), text: T_FIX.done }]);
    afterFixRef.current = true;
    const lastId = [...itemsRef.current].reverse().find(i => i.kind === "assistant")?.id;
    // Let the edited draft's version arrive first, so the new reply is labelled with it.
    setTimeout(() => void send(question, lastId === replyId ? "again" : "new"), 0);
  };

  const openAddFact = (id: string) => {
    const box = document.getElementById(`ally-dt-addfact-${id}`);
    box?.scrollIntoView?.({ block: "center" });
    (box?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
  };

  const newChat = () => {
    persona.current += 1;
    setPlaying(null);
    run.current += 1;
    stream.cancel();
    conversation.current = undefined;
    setItems([]);
    setPending(null);
    setFailed(null);
    setText("");
  };

  /** Lets the render and its effects land, so the next send sees the chat as it now is. */
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  /** A persona: a new chat, then its fixed messages one by one, each after the last reply. */
  const play = async (script: PersonaScript) => {
    setMenuOpen(false);
    newChat();
    const token = (persona.current += 1);
    setPlaying(script.label);
    await settle();
    for (const turn of script.turns) {
      if (token !== persona.current) return;
      const ok = await send(turn, "new");
      if (!ok || token !== persona.current) break;
      await settle();
    }
    if (token === persona.current) setPlaying(null);
  };

  const stopPlaying = () => {
    persona.current += 1;
    setPlaying(null);
  };

  const checkLikely = () => {
    setLikelyBusy(true);
    setLikelyRun(n => n + 1);
  };

  /** Puts a likely question and its reply into the chat as an ordinary exchange. */
  const openInChat = (row: LikelyResult) => {
    setItems(list => [
      ...list,
      { kind: "user", id: nextId("u"), text: row.question },
      {
        kind: "assistant",
        id: nextId("a"),
        text: row.reply,
        version: versionRef.current,
        why: null,
        pendingDocuments: 0,
        editsSearchable: true,
        faded: false,
        question: row.question,
        unanswered: row.handledBy === "declined",
        afterFix: false,
      },
    ]);
  };

  if (!usable) {
    return (
      <div className="ally-dt ally-dt--empty" data-testid="draft-test-pane">
        <p className="ally-small">{placeholder ?? T.placeholder}</p>
      </div>
    );
  }

  const lastReply = [...items].reverse().find(item => item.kind === "assistant");
  const stale = !pending && lastReply?.kind === "assistant" && olderThanNow(lastReply);
  const suggestions = view.draft.suggestedQuestions ?? [];
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || pending || playing || finished || aiOff) return;
    setText("");
    void send(value, "new");
  };

  return (
    <section className="ally-dt" data-testid="draft-test-pane" aria-label={T.title}>
      {/* First in the pane: the edit announcement stays the pane's first polite region. */}
      <span key={announce.n} className="ally-sr-only" aria-live="polite">
        {announce.text}
      </span>
      <div className="ally-dt__head">
        <h2 className="ally-dt__title">{T.title}</h2>
        <div className="ally-dt__actions">
          {unanswered.length > 0 && (
            <Button
              variant="ghost"
              aria-expanded={listOpen}
              aria-controls="ally-dt-unanswered"
              onClick={() => setListOpen(o => !o)}
            >
              {fill(T_UNANSWERED.button, { n: unanswered.length })}
            </Button>
          )}
          {(items.length > 0 || pending) && (
            <Button variant="ghost" onClick={newChat}>
              {T.newChat}
            </Button>
          )}
        </div>
      </div>
      <div className="ally-dt__tools">
        <Segmented<Channel>
          label={T_CHANNEL.label}
          value={channel}
          onChange={setChannel}
          options={CHANNELS}
        />
        {!finished && (
          <div className="ally-dt__actions">
            <div
              className="ally-dt__menu"
              onKeyDown={event => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
            >
              <Button
                variant="ghost"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-controls="ally-dt-tryas"
                disabled={Boolean(pending) || Boolean(playing) || Boolean(aiOff)}
                onClick={() => setMenuOpen(o => !o)}
              >
                {T_TRY.button}
              </Button>
              {menuOpen && (
                <ul id="ally-dt-tryas" className="ally-dt__menu-list" aria-label={T_TRY.menuLabel}>
                  {PERSONA_SCRIPTS.map(script => (
                    <li key={script.id}>
                      <button
                        type="button"
                        className="ally-dt__menu-item"
                        onClick={() => void play(script)}
                      >
                        <span>{script.label}</span>
                        <span className="ally-small">{script.hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button
              variant="ghost"
              disabled={likelyBusy || Boolean(pending) || Boolean(playing) || Boolean(aiOff)}
              onClick={checkLikely}
            >
              {T_LIKELY.button}
            </Button>
          </div>
        )}
      </div>
      {playing && (
        <p className="ally-small ally-dt__playing" role="status">
          <span>{fill(T_TRY.playing, { label: playing })}</span>
          <button type="button" className="ally-dt__link" onClick={stopPlaying}>
            {T_TRY.stop}
          </button>
        </p>
      )}
      {fix && (
        <span className="ally-sr-only" aria-live="polite">
          {shownCount > 0 ? fill(T_UNANSWERED.announce, { n: shownCount }) : ""}
        </span>
      )}
      {fix && listOpen && unanswered.length > 0 && (
        <ul
          id="ally-dt-unanswered"
          className="ally-dt__unanswered"
          aria-label={T_UNANSWERED.heading}
        >
          {unanswered.map(row => (
            <li key={row.question}>
              <span className="ally-small">{row.question}</span>
              <Button variant="secondary" onClick={() => openAddFact(row.id)}>
                {T_UNANSWERED.addFact}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="ally-dt__scroll" ref={scroller}>
        {likelyRun > 0 && (
          <LikelyQuestions
            key={likelyRun}
            draftId={draftId}
            disabled={Boolean(pending) || Boolean(playing)}
            onOpen={openInChat}
            onFinished={() => setFinished(true)}
            onBusy={setLikelyBusy}
            onClose={() => setLikelyRun(0)}
          />
        )}
        {channel !== "page" && (
          <div
            className={`ally-dt__strip ally-dt__strip--${channel}`}
            data-testid="draft-test-strip"
          >
            {channel === "whatsapp" ? T_CHANNEL.whatsappStrip : T_CHANNEL.widgetStrip}
            {view.draft.assistantName ? ` · ${view.draft.assistantName}` : ""}
          </div>
        )}
        {items.length === 0 && !pending && (
          <div className="ally-dt__intro">
            {view.draft.introduction && (
              <p>
                {view.draft.assistantName && <strong>{view.draft.assistantName}</strong>}
                {view.draft.assistantName ? ": " : ""}
                {view.draft.introduction}
              </p>
            )}
            {!finished && !aiOff && suggestions.length > 0 && (
              <div className="ally-chips" role="group" aria-label={T.suggested}>
                {suggestions.map(question => (
                  <Chip key={question} outline onToggle={() => void send(question, "new")}>
                    {question}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        <ol
          className={`ally-dt__list ally-dt__list--${channel}`}
          data-testid="draft-test-transcript"
        >
          {items.map(item => {
            if (item.kind === "note") {
              return (
                <li key={item.id} className="ally-dt__note ally-small">
                  {T.updated}
                </li>
              );
            }
            if (item.kind === "info") {
              return (
                <li key={item.id} className="ally-dt__note ally-small" role="status">
                  {item.text}
                </li>
              );
            }
            if (item.kind === "user") {
              return (
                <li key={item.id} className="ally-dt__msg ally-dt__msg--user">
                  <span className="ally-dt__who">{T.you}</span>
                  <p>{item.text}</p>
                </li>
              );
            }
            const isLast = item === lastReply;
            return (
              <li
                key={item.id}
                className={`ally-dt__msg ally-dt__msg--assistant${item.faded ? " is-faded" : ""}`}
              >
                <span className="ally-dt__who">
                  {T.assistant}
                  {olderThanNow(item) && <span className="ally-dt__older"> · {T.older}</span>}
                </span>
                <p>{item.text}</p>
                {(item.parts || item.confirmation) && (
                  // BT1: the bot page's own cards and chips, in its look.
                  <div className="brand-surface ally-dt__parts">
                    {item.confirmation && (
                      <ConfirmationCard
                        confirmation={item.confirmation}
                        copy={pageCopy}
                        when={item.confirmation.title}
                      >
                        <TestOnly text={item.confirmation.testOnly} />
                      </ConfirmationCard>
                    )}
                    {item.parts && (
                      <ReplyPartsView
                        parts={item.parts}
                        active={isLast && !pending}
                        onTap={button => void send(button.label, "new", button.token)}
                      />
                    )}
                  </div>
                )}
                {item.starter && (
                  <p className="ally-small" data-testid="draft-test-starter">
                    {BUILD_COPY.starter}
                  </p>
                )}
                {item.workingCopy && (
                  <p className="ally-small" data-testid="draft-test-working-copy">
                    {BUILD_COPY.workingCopy}
                  </p>
                )}
                {(item.pendingDocuments > 0 || !item.editsSearchable) && (
                  <p className="ally-small">
                    {item.afterFix || !item.editsSearchable
                      ? SPLIT_COPY.stillLearning
                      : T.stillReading}
                  </p>
                )}
                {item.why && <ReplyDetails why={item.why} />}
                {fix && !item.faded && (
                  <div className="ally-dt__actions">
                    <Button
                      variant="ghost"
                      aria-expanded={fixing === item.id}
                      onClick={() => setFixing(f => (f === item.id ? null : item.id))}
                    >
                      {T_FIX.button}
                    </Button>
                    {view.chatbotId && (
                      <SaveAsTest chatbotId={view.chatbotId} question={item.question} />
                    )}
                  </div>
                )}
                {fix && fixing === item.id && (
                  <FixPanel
                    id={item.id}
                    question={item.question}
                    view={view}
                    tools={fix}
                    onFixed={() => reask(item.question, item.id)}
                    onClose={() => setFixing(null)}
                  />
                )}
                {fix && !item.faded && item.unanswered && (
                  <AddFactBox
                    id={item.id}
                    question={item.question}
                    tools={fix}
                    onDone={() => reask(item.question, item.id)}
                  />
                )}
                {isLast && stale && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const asked = [...items].reverse().find(i => i.kind === "user");
                      if (asked?.kind === "user") void send(asked.text, "again");
                    }}
                  >
                    {T.askAgain}
                  </Button>
                )}
              </li>
            );
          })}
          {pending && (
            <li className="ally-dt__msg ally-dt__msg--assistant" data-testid="draft-test-pending">
              <span className="ally-dt__who">{T.assistant}</span>
              {pending.text ? <p>{pending.text}</p> : null}
              <p className="ally-small ally-dt__status" role="status">
                <Orb size={14} working />
                {T.status[pending.status]}
              </p>
            </li>
          )}
        </ol>
        {failed && (
          <div className="ally-dt__failed" role="alert">
            <p>{T.failed}</p>
            <Button variant="secondary" onClick={() => void send(failed, "retry")}>
              {T.tryAgain}
            </Button>
          </div>
        )}
        {finished && <p className="ally-small">{T.finished}</p>}
      </div>
      {!finished && <CrawlProgress view={view} />}
      {!finished && aiOff && (
        <p className="ally-small" role="note" data-testid="draft-test-credits">
          {aiOff}
        </p>
      )}
      {!finished && !aiOff && (
        <form className="ally-dt__form" onSubmit={submit}>
          <input
            className="ally-input"
            aria-label={T.inputLabel}
            placeholder={T.inputPlaceholder}
            value={text}
            disabled={Boolean(pending) || Boolean(playing)}
            onChange={event => setText(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={Boolean(pending) || Boolean(playing) || !text.trim()}
          >
            {T.send}
          </Button>
        </form>
      )}
    </section>
  );
};
