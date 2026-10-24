import { FC, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  APPOINTMENT_SLOTS,
  AppointmentSlot,
  buildIcs,
  localTimezone,
  rememberedShiftEnd,
  rememberShiftEnd,
  slotTime,
} from "./appointment";

import type { GuideCard } from "../../contract/wire";

export interface ClosingRitualCardProps {
  card: GuideCard;
  /** CARE: only the appointment row, plus "Whenever you're ready". */
  careMode: boolean;
  courseTitle: string;
  journeyUrl: string;
  /** Saves the appointment; rejects when it couldn't be saved. */
  onSchedule: (slot: AppointmentSlot, at: Date, timezone: string) => Promise<void>;
  now?: () => Date;
}

type Phase = "choosing" | "askShift" | "custom" | "saving" | "saved" | "failed" | "whenever";

const payloadText = (card: GuideCard, key: string): string | null => {
  const value = (card.payload as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const chip =
  "min-h-9 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-3 font-primary text-sm text-[var(--g-ink)] transition-colors hover:border-[var(--g-ink-faint)] max-md:min-h-11";

/**
 * "Before you go" (plan §5.10, card grammar §5.3): today's noticing, one
 * thing to watch for, when to pick this up, and a one-line teaser. No
 * appointment is ever required, and skipping it is silent.
 */
export const ClosingRitualCard: FC<ClosingRitualCardProps> = ({
  card,
  careMode,
  courseTitle,
  journeyUrl,
  onSchedule,
  now = () => new Date(),
}) => {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>("choosing");
  const [chosen, setChosen] = useState<{ slot: AppointmentSlot; at: Date } | null>(null);
  const [shiftEnd, setShiftEnd] = useState(rememberedShiftEnd() ?? "");
  const [custom, setCustom] = useState("");

  const noticing = payloadText(card, "noticing");
  const watchFor = payloadText(card, "watchFor");
  const teaser = payloadText(card, "teaser");

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
    [i18n.language],
  );

  const save = async (slot: AppointmentSlot, when: Date) => {
    setChosen({ slot, at: when });
    setPhase("saving");
    try {
      await onSchedule(slot, when, localTimezone());
      setPhase("saved");
    } catch {
      setPhase("failed");
    }
  };

  const pick = (slot: AppointmentSlot) => {
    if (slot === "custom") {
      setPhase("custom");
      return;
    }
    const when = slotTime(slot, now(), shiftEnd);
    if (slot === "afterShift" && !when) {
      setPhase("askShift");
      return;
    }
    if (when) void save(slot, when);
  };

  const downloadIcs = () => {
    if (!chosen) return;
    const ics = buildIcs({
      start: chosen.at,
      title: t("guide.closing.calendarTitle", { course: courseTitle }),
      url: journeyUrl,
      uid: `${card.cardId}@ally`,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ally.ics";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (card.state === "done" && chosen === null && payloadText(card, "appointmentLabel")) {
    return (
      <p className="g-caption" data-testid="closing-ritual-done">
        {t("guide.closing.next", { when: payloadText(card, "appointmentLabel") })}
      </p>
    );
  }

  return (
    <section
      aria-labelledby={`closing-${card.cardId}`}
      data-testid="closing-ritual"
      className="g-rise rounded-2xl border border-[var(--g-ally-edge)] bg-[var(--g-ally-wash)] p-4 sm:p-5"
    >
      <h3 id={`closing-${card.cardId}`} className="g-label text-[var(--g-ally-label)]">
        {t("guide.closing.title")}
      </h3>
      {!careMode && noticing && <p className="g-prose mt-2">{noticing}</p>}
      {!careMode && watchFor && (
        <p className="mt-2 font-secondary text-base text-[var(--g-ink-soft)]">
          {t("guide.closing.watchFor", { thing: watchFor })}
        </p>
      )}

      <p className="mt-4 font-primary text-[15px] font-semibold text-[var(--g-ink)]">
        {t("guide.closing.when")}
      </p>

      {phase === "whenever" ? (
        <p className="mt-2 font-secondary text-base text-[var(--g-ink)]">
          {t("guide.closing.whenever")}
        </p>
      ) : phase === "saved" && chosen ? (
        <div className="mt-2 flex flex-wrap items-center gap-3" aria-live="polite">
          <p className="font-secondary text-base text-[var(--g-ink)]">
            {t("guide.closing.saved", { when: formatter.format(chosen.at) })}
          </p>
          <button
            type="button"
            onClick={downloadIcs}
            className="font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
          >
            {t("guide.closing.addToCalendar")}
          </button>
          <button
            type="button"
            onClick={() => setPhase("choosing")}
            className="font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2"
          >
            {t("guide.closing.change")}
          </button>
        </div>
      ) : phase === "askShift" ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            if (!shiftEnd) return;
            rememberShiftEnd(shiftEnd);
            const when = slotTime("afterShift", now(), shiftEnd);
            if (when) void save("afterShift", when);
          }}
        >
          <label className="flex flex-col gap-1 font-primary text-sm text-[var(--g-ink-soft)]">
            {t("guide.closing.shiftEnds")}
            <input
              type="time"
              value={shiftEnd}
              onChange={event => setShiftEnd(event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-2 text-[var(--g-ink)]"
            />
          </label>
          <button type="submit" className={chip}>
            {t("guide.closing.save")}
          </button>
        </form>
      ) : phase === "custom" ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            const when = custom ? new Date(custom) : null;
            if (when && !Number.isNaN(when.getTime())) void save("custom", when);
          }}
        >
          <label className="flex flex-col gap-1 font-primary text-sm text-[var(--g-ink-soft)]">
            {t("guide.closing.pickTime")}
            <input
              type="datetime-local"
              value={custom}
              onChange={event => setCustom(event.target.value)}
              className="min-h-10 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-2 text-[var(--g-ink)]"
            />
          </label>
          <button type="submit" className={chip}>
            {t("guide.closing.save")}
          </button>
        </form>
      ) : (
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="group"
          aria-label={t("guide.closing.when")}
        >
          {APPOINTMENT_SLOTS.map(slot => (
            <button
              key={slot}
              type="button"
              onClick={() => pick(slot)}
              disabled={phase === "saving"}
              className={chip}
            >
              {t(`guide.closing.slot.${slot}`)}
            </button>
          ))}
          {careMode && (
            <button type="button" onClick={() => setPhase("whenever")} className={chip}>
              {t("guide.closing.slot.whenever")}
            </button>
          )}
        </div>
      )}
      {phase === "failed" && (
        <p className="mt-2 font-secondary text-base text-[var(--g-ink)]" aria-live="polite">
          {t("guide.closing.failed")}
        </p>
      )}

      {!careMode && teaser && (
        <p className="mt-4 font-secondary text-base italic text-[var(--g-ink-soft)]">
          {t("guide.closing.teaser", { teaser })}
        </p>
      )}
    </section>
  );
};
