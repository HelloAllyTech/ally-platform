import { CSSProperties, FC, useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGetGuideAdviceQuery, useSubmitGuideAdviceMutation } from "@api";

import { useBackToClose, useFocusTrap } from "../../layout/Panels";
import { AllyPresence } from "../../presence/AllyPresence";
import { CardFrame } from "../CardFrame";

import type { GuideCard, GuideFinaleDoor, GuideFinalePayload } from "../../contract/wire";
import type { SpineModel } from "../../state/spineModel";

/** A finale card's payload, when it is the contract's shape (older cards carry before/now). */
export const finalePayloadOf = (card: GuideCard): GuideFinalePayload | null => {
  const payload = card.payload as Partial<GuideFinalePayload> | undefined;
  if (!payload || typeof payload.hushed !== "boolean" || !Array.isArray(payload.doors)) {
    return null;
  }
  return {
    hushed: payload.hushed,
    firstMove: payload.firstMove ?? null,
    possibleSelf: payload.possibleSelf ?? null,
    noticings: Array.isArray(payload.noticings) ? payload.noticings : [],
    doors: payload.doors,
  };
};

const step = (n: number): CSSProperties => ({ ["--step" as string]: n }) as CSSProperties;

const quote =
  "border-l-2 border-[var(--g-quote-rule)] pl-4 font-secondary text-[19px] italic leading-7 text-[var(--g-ink)]";
const action =
  "inline-flex min-h-11 items-center rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)] disabled:opacity-50";
const quiet =
  "inline-flex min-h-11 items-center rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-4 font-primary text-[15px] text-[var(--g-ink)] hover:border-[var(--g-ink-faint)] disabled:opacity-50";

/**
 * The finale in the conversation: one card that opens the reveal (and
 * reopens it later). It never scores anything.
 */
export const FinaleCard: FC<{ card: GuideCard; onOpen: () => void }> = ({ card, onOpen }) => {
  const { t } = useTranslation();
  return (
    <CardFrame
      testId={`card-${card.cardId}`}
      state="ready"
      surface="ally"
      typeWord={t("guide.finale.label")}
      title={card.title || t("guide.finale.title")}
      framing={t("guide.finale.framing")}
      primary={{ label: t("guide.finale.open"), onClick: onOpen }}
    />
  );
};

export interface FinaleRevealProps {
  open: boolean;
  card: GuideCard;
  payload: GuideFinalePayload;
  spine: SpineModel;
  trackId: string;
  onClose: () => void;
  /** The learner's words back to Ally (their first move again, the possible self). */
  onReply: (text: string) => void;
  onScheduleRecall: (at: Date, timezone: string) => Promise<void>;
  onDoor: (door: GuideFinaleDoor["kind"]) => void;
}

/**
 * The finale reveal (plan §5.10, §3 stage 13), full screen. The course map
 * fills from the first node to the last; the first move sits beside an
 * invitation to answer it now; the possible self is revisited; Ally's
 * noticing moments replay; then three doors. Every part is the learner's
 * own words or Ally's noticing, never a score, and a part with nothing
 * behind it is left out. Hushed (heavy material, or a hard moment): the same
 * content, quiet and still (Stacks: "Self-Cheer as Emotional Reward at
 * Win-State" — marked deliberately, and only where it fits).
 */
export const FinaleReveal: FC<FinaleRevealProps> = ({
  open,
  card,
  payload,
  spine,
  trackId,
  onClose,
  onReply,
  onScheduleRecall,
  onDoor,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [swept, setSwept] = useState(payload.hushed);
  useFocusTrap(ref, open, onClose);
  useBackToClose(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    headingRef.current?.focus();
    if (payload.hushed) return undefined;
    // The map fills once the reveal is on screen.
    const timer = setTimeout(() => setSwept(true), 300);
    return () => clearTimeout(timer);
  }, [open, payload.hushed]);

  if (!open) return null;
  const nodes = spine.chapters.flatMap(chapter => chapter.nodes);
  const doors = payload.doors.filter(door => door.available !== false);
  let n = 0;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="g-finale guide-shell fixed inset-0 z-50 overflow-y-auto font-primary"
      data-atmosphere={payload.hushed ? "hushed" : "bright"}
      data-hushed={payload.hushed}
      data-swept={swept}
      data-testid="finale-reveal"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="g-finale-step flex flex-col items-start gap-3" style={step(n++)}>
          <AllyPresence state="idle" size={56} />
          <p className="g-label text-[var(--g-ally-label)]">{t("guide.finale.label")}</p>
          <h1
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="font-primary text-[28px] font-semibold leading-[34px] text-[var(--g-ink)] outline-none [text-wrap:balance] md:text-[40px] md:leading-[46px]"
          >
            {card.title || t("guide.finale.title")}
          </h1>
        </header>

        {nodes.length > 0 && (
          <section className="g-finale-step" style={step(n++)} aria-label={t("guide.finale.map")}>
            <ol className="flex flex-wrap items-center gap-1.5" data-testid="finale-map">
              {nodes.map((node, index) => (
                <li
                  key={node.id}
                  className="g-finale-node h-2.5 w-2.5 rounded-full"
                  style={{ ["--node" as string]: index } as CSSProperties}
                  title={node.title}
                />
              ))}
            </ol>
            <p className="g-caption mt-2">{t("guide.finale.mapLine", { count: nodes.length })}</p>
          </section>
        )}

        {payload.firstMove && (
          <FirstMove style={step(n++)} firstMove={payload.firstMove} onReply={onReply} />
        )}

        {payload.possibleSelf && (
          <section className="g-finale-step flex flex-col gap-3" style={step(n++)}>
            <p className="g-label text-[var(--g-ink-faint)]">{t("guide.finale.possibleSelf")}</p>
            <blockquote className={quote}>{payload.possibleSelf.text}</blockquote>
            <p className="g-prose text-[var(--g-ink-soft)]">{payload.possibleSelf.invitation}</p>
            <ReplyChips
              options={[t("guide.finale.stillFits"), t("guide.finale.changed")]}
              onReply={onReply}
            />
          </section>
        )}

        {payload.noticings.length > 0 && (
          <section className="g-finale-step flex flex-col gap-3" style={step(n++)}>
            <p className="g-label text-[var(--g-ink-faint)]">{t("guide.finale.noticed")}</p>
            <ul className="flex flex-col gap-2" data-testid="finale-noticings">
              {payload.noticings.map((noticing, index) => (
                <li
                  key={`${index}-${noticing}`}
                  className="g-prose border-l-2 border-[var(--g-ally-edge)] pl-4 text-[var(--g-ink)]"
                >
                  {noticing}
                </li>
              ))}
            </ul>
          </section>
        )}

        {doors.length > 0 && (
          <section className="g-finale-step flex flex-col gap-3" style={step(n++)}>
            <p className="g-label text-[var(--g-ink-faint)]">{t("guide.finale.doors")}</p>
            <div className="flex flex-col gap-3" data-testid="finale-doors">
              {doors.map(door => (
                <Door
                  key={door.kind}
                  door={door}
                  trackId={trackId}
                  onReply={onReply}
                  onScheduleRecall={onScheduleRecall}
                  onDoor={onDoor}
                />
              ))}
            </div>
          </section>
        )}

        <AdviceFromOthers trackId={trackId} style={step(n++)} />

        <footer className="mt-auto flex justify-start pb-[env(safe-area-inset-bottom)]">
          <button type="button" onClick={onClose} className={quiet}>
            {t("guide.panel.backToAlly")}
          </button>
        </footer>
      </div>
    </div>
  );
};

const FirstMove: FC<{
  firstMove: NonNullable<GuideFinalePayload["firstMove"]>;
  onReply: (text: string) => void;
  style: CSSProperties;
}> = ({ firstMove, onReply, style }) => {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <section
      className="g-finale-step flex flex-col gap-3"
      style={style}
      data-testid="finale-first-move"
    >
      <p className="g-label text-[var(--g-ink-faint)]">{t("guide.finale.atTheStart")}</p>
      {firstMove.question && (
        <p className="g-caption">{t("guide.finale.allyAsked", { question: firstMove.question })}</p>
      )}
      <blockquote className={quote}>{firstMove.text}</blockquote>
      <label htmlFor={id} className="g-prose text-[var(--g-ink-soft)]">
        {firstMove.invitation}
      </label>
      {sent ? (
        <p className="g-caption" role="status">
          {t("guide.finale.sent")}
        </p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault();
            if (!text.trim()) return;
            onReply(text.trim());
            setSent(true);
          }}
        >
          <textarea
            id={id}
            rows={3}
            value={text}
            maxLength={2000}
            onChange={event => setText(event.target.value)}
            placeholder={t("guide.finale.nowPlaceholder")}
            className="min-h-24 w-full resize-y rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 py-2 font-secondary text-[17px] leading-6 text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-faint)] focus:border-[var(--g-ink-faint)]"
          />
          <div>
            <button type="submit" className={action} disabled={!text.trim()}>
              {t("guide.finale.sendNow")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

const ReplyChips: FC<{ options: string[]; onReply: (text: string) => void }> = ({
  options,
  onReply,
}) => {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string | null>(null);
  if (chosen) {
    return (
      <p className="g-caption" role="status">
        {t("guide.finale.sent")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => (
        <button
          key={option}
          type="button"
          className={quiet}
          onClick={() => {
            setChosen(option);
            onReply(option);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

/** "Wed 31 Oct, 9:00", in the reader's language and zone. */
const whenLabel = (date: Date, language: string): string => {
  try {
    return new Intl.DateTimeFormat(language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

/** `datetime-local` value for a date, in local time. */
const localInputValue = (date: Date): string => {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

const Door: FC<{
  door: GuideFinaleDoor;
  trackId: string;
  onReply: (text: string) => void;
  onScheduleRecall: (at: Date, timezone: string) => Promise<void>;
  onDoor: (door: GuideFinaleDoor["kind"]) => void;
}> = ({ door, trackId, onReply, onScheduleRecall, onDoor }) => (
  <article
    className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-4 sm:p-5"
    data-testid={`door-${door.kind}`}
    aria-label={door.title}
  >
    <h2 className="g-title">{door.title}</h2>
    <p className="g-prose mt-1 text-[var(--g-ink-soft)]">{door.body}</p>
    <div className="mt-3">
      {door.kind === "field_assignment" ? (
        <FieldDoor onReply={onReply} onDoor={onDoor} />
      ) : door.kind === "spaced_recall" ? (
        <RecallDoor door={door} onScheduleRecall={onScheduleRecall} />
      ) : (
        <AdviceDoor door={door} trackId={trackId} onDoor={onDoor} />
      )}
    </div>
  </article>
);

const FieldDoor: FC<{
  onReply: (text: string) => void;
  onDoor: (door: GuideFinaleDoor["kind"]) => void;
}> = ({ onReply, onDoor }) => {
  const { t } = useTranslation();
  const [taken, setTaken] = useState(false);
  if (taken) {
    return (
      <p className="g-caption" role="status">
        {t("guide.finale.fieldTaken")}
      </p>
    );
  }
  return (
    <button
      type="button"
      className={action}
      onClick={() => {
        setTaken(true);
        onReply(t("guide.finale.fieldReply"));
        onDoor("field_assignment");
      }}
    >
      {t("guide.finale.fieldTake")}
    </button>
  );
};

const RecallDoor: FC<{
  door: GuideFinaleDoor;
  onScheduleRecall: (at: Date, timezone: string) => Promise<void>;
}> = ({ door, onScheduleRecall }) => {
  const { t, i18n } = useTranslation();
  const id = useId();
  const suggested = door.suggestedAt ? new Date(door.suggestedAt) : null;
  const [picking, setPicking] = useState(!suggested || Number.isNaN(suggested.getTime()));
  const [custom, setCustom] = useState(() =>
    localInputValue(
      suggested && !Number.isNaN(suggested.getTime())
        ? suggested
        : new Date(Date.now() + 7 * 86_400_000),
    ),
  );
  const [saved, setSaved] = useState<Date | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const book = async (at: Date) => {
    setState("saving");
    try {
      await onScheduleRecall(at, timezone);
      setSaved(at);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  if (saved) {
    return (
      <p className="g-caption" role="status" data-testid="recall-saved">
        {t("guide.closing.saved", { when: whenLabel(saved, i18n.language) })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {!picking && suggested ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={action}
            disabled={state === "saving"}
            onClick={() => void book(suggested)}
          >
            {t("guide.finale.remindOn", { when: whenLabel(suggested, i18n.language) })}
          </button>
          <button
            type="button"
            className="min-h-11 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
            onClick={() => setPicking(true)}
          >
            {t("guide.finale.anotherDay")}
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            const at = new Date(custom);
            if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
            void book(at);
          }}
        >
          <label
            htmlFor={id}
            className="flex flex-col gap-1 font-primary text-sm text-[var(--g-ink-soft)]"
          >
            {t("guide.closing.pickTime")}
            <input
              id={id}
              type="datetime-local"
              value={custom}
              min={localInputValue(new Date())}
              onChange={event => setCustom(event.target.value)}
              className="min-h-11 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 text-[var(--g-ink)]"
            />
          </label>
          <button type="submit" className={action} disabled={state === "saving"}>
            {t("guide.closing.save")}
          </button>
        </form>
      )}
      {state === "failed" && (
        <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
          {t("guide.closing.failed")}
        </p>
      )}
    </div>
  );
};

const STATUS_KEY = {
  pending: "guide.advice.pending",
  approved: "guide.advice.approved",
  rejected: "guide.advice.rejected",
} as const;

/**
 * The mentor door: one line for the next learner (finishers only; one per
 * course, rewritable while it waits for review). The server says why when
 * it refuses (not finished, already reviewed, too long), and that is shown.
 */
const AdviceDoor: FC<{
  door: GuideFinaleDoor;
  trackId: string;
  onDoor: (door: GuideFinaleDoor["kind"]) => void;
}> = ({ door, trackId, onDoor }) => {
  const { t } = useTranslation();
  const id = useId();
  const { data, isLoading } = useGetGuideAdviceQuery({ trackId });
  const [submit, { isLoading: saving }] = useSubmitGuideAdviceMutation();
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const max = door.maxChars ?? data?.maxChars ?? 200;
  const mine = data?.mine;
  const editable = !mine || mine.status === "pending";
  const value = text ?? (mine?.status === "pending" ? mine.text : "");
  const over = value.length > max;

  if (isLoading) return <div className="g-skeleton h-20 w-full" />;

  const send = async () => {
    setProblem(null);
    try {
      await submit({ trackId, body: { text: value.trim() } }).unwrap();
      setText(null);
      onDoor("mentor");
    } catch (error) {
      const message = (error as { data?: { message?: unknown } } | undefined)?.data?.message;
      setProblem(typeof message === "string" ? message : t("guide.advice.failed"));
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="advice-door">
      {mine && (
        <p className="g-caption" role="status" data-testid="advice-status">
          {t(STATUS_KEY[mine.status])}
        </p>
      )}
      {editable ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault();
            if (!value.trim() || over || saving) return;
            void send();
          }}
        >
          <label htmlFor={id} className="sr-only">
            {door.title}
          </label>
          <textarea
            id={id}
            rows={2}
            value={value}
            onChange={event => setText(event.target.value)}
            placeholder={t("guide.advice.placeholder")}
            aria-invalid={over}
            className="min-h-20 w-full resize-y rounded-[10px] border border-[var(--g-line)] bg-[var(--g-card)] px-3 py-2 font-secondary text-[17px] leading-6 text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-faint)] focus:border-[var(--g-ink-faint)]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={action} disabled={!value.trim() || over || saving}>
              {mine ? t("guide.advice.update") : t("guide.advice.send")}
            </button>
            <span className="g-caption" aria-live="polite">
              {t("guide.advice.count", { count: value.length, max })}
            </span>
          </div>
          <p className="g-caption">{t("guide.advice.review")}</p>
        </form>
      ) : (
        <blockquote className={quote}>{mine?.text}</blockquote>
      )}
      {problem && (
        <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
          {problem}
        </p>
      )}
    </div>
  );
};

/**
 * Lines from people in the learner's organisation who finished before them,
 * approved and anonymous, shown only once enough have finished (the server
 * decides). Each is a quotation, rendered as plain text.
 */
const AdviceFromOthers: FC<{ trackId: string; style: CSSProperties }> = ({ trackId, style }) => {
  const { t } = useTranslation();
  const { data } = useGetGuideAdviceQuery({ trackId });
  if (!data?.lines.length) return null;
  return (
    <section className="g-finale-step flex flex-col gap-3" style={style} data-testid="advice-lines">
      <p className="g-label text-[var(--g-ink-faint)]">{t("guide.advice.fromOthers")}</p>
      <ul className="flex flex-col gap-2">
        {data.lines.map((line, index) => (
          <li key={`${index}-${line}`}>
            <blockquote className={quote}>{line}</blockquote>
          </li>
        ))}
      </ul>
    </section>
  );
};
