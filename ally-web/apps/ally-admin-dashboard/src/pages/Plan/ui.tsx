import React, { useId } from "react";

import type { PlanAlert, PlanSeat, UsageBar } from "@api";

import { PLAN } from "./copy";
import { compactCount, fullCount, levelOf, longDay, shortDay } from "./format";

import "./plan.css";

/**
 * A limit as a plain bar with its numbers and reset date (CR1 §C3). Unlimited shows "Unlimited"
 * and no bar. Counts only: never a price.
 */
export const Meter: React.FC<{
  label: string;
  bar: UsageBar;
  hint?: string;
  /** Token amounts read compactly (1.2M); counts exactly (1,000). */
  compact?: boolean;
  testId?: string;
}> = ({ label, bar, hint, compact, testId }) => {
  const number = compact ? compactCount : fullCount;
  const level = levelOf(bar.used, bar.limit);
  const width = bar.limit ? Math.min(100, Math.max(0, (bar.used / bar.limit) * 100)) : 0;
  return (
    <div className={`ally-meter ally-meter--${level}`} data-testid={testId}>
      <div className="ally-meter__head">
        <span className="ally-meter__label">{label}</span>
        <span className="ally-meter__value">
          {bar.limit === null
            ? `${PLAN.month.unlimited} · ${PLAN.month.used(number(bar.used))}`
            : PLAN.month.of(number(bar.used), number(bar.limit))}
        </span>
      </div>
      {bar.limit !== null && (
        <div
          className="ally-meter__track"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={bar.limit}
          aria-valuenow={Math.min(bar.used, bar.limit)}
        >
          <div className="ally-meter__fill" style={{ width: `${width}%` }} />
        </div>
      )}
      <span className="ally-meter__foot">
        {[hint, PLAN.month.resets(shortDay(bar.resetsOn))].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
};

/** Limits at 80% or more this period: on Plan and usage and the assistants list. */
export const PlanAlertsBanner: React.FC<{
  alerts: PlanAlert[] | undefined;
  onOpen?: () => void;
}> = ({ alerts, onOpen }) => {
  if (!alerts?.length) return null;
  return (
    <div className="ally-plan-alert" role="status" data-testid="plan-alerts">
      <div>
        <p className="ally-plan-alert__title">{PLAN.alerts.title}</p>
        <ul>
          {alerts.map(alert => (
            <li key={alert.what}>{PLAN.alerts.line(alert.what, alert.percent)}</li>
          ))}
        </ul>
      </div>
      {onOpen && (
        <button type="button" onClick={onOpen}>
          {PLAN.alerts.more}
        </button>
      )}
    </div>
  );
};

const statusBadge = (seat: PlanSeat) => {
  const word = PLAN.seats.status[seat.status];
  if (!word) return null;
  const tone = seat.status === "expiring" ? "warn" : "muted";
  return <span className={`ally-badge ally-badge--${tone}`}>{word}</span>;
};

export interface SeatAssigning {
  /** People who may hold a seat: the assistant's team and invited people. */
  people: { email: string; hasSeat: boolean }[];
  busy: boolean;
  onAssign: (seatId: string, email: string | null) => void;
}

const SeatAssign: React.FC<{ seat: PlanSeat; index: number; assigning: SeatAssigning }> = ({
  seat,
  index,
  assigning,
}) => {
  const id = useId();
  const choices = assigning.people.filter(
    person => !person.hasSeat || person.email === seat.assigneeEmail,
  );
  return (
    <div className="ally-seat__assign">
      <label htmlFor={id} className="ally-small">
        {PLAN.seats.holder}
      </label>
      <select
        id={id}
        className="ally-input ally-input--compact"
        aria-label={PLAN.seats.holderLabel(String(index + 1))}
        value={seat.assigneeEmail ?? ""}
        disabled={assigning.busy || seat.status === "cancelled"}
        data-testid={`seat-assign-${seat.id}`}
        onChange={event => assigning.onAssign(seat.id, event.target.value || null)}
      >
        <option value="">{PLAN.seats.nobody}</option>
        {choices.map(person => (
          <option key={person.email} value={person.email}>
            {person.email}
          </option>
        ))}
      </select>
    </div>
  );
};

/** An assistant's seats: type, included or extra, who holds it, renewal, status and messages. */
export const SeatList: React.FC<{ seats: PlanSeat[]; assigning?: SeatAssigning }> = ({
  seats,
  assigning,
}) => {
  if (!seats.length) return <p className="ally-small">{PLAN.seats.noSeats}</p>;
  return (
    <ul className="ally-seats" aria-label={PLAN.seats.title} data-testid="seat-list">
      {seats.map((seat, index) => (
        <li key={seat.id} className="ally-seat" data-testid="seat-row">
          <div className="ally-seat__main">
            <span className="ally-seat__title">
              <span>{seat.typeName}</span>
              <span className="ally-badge ally-badge--muted">
                {seat.kind === "extra" ? PLAN.seats.extra : PLAN.seats.included}
              </span>
              {statusBadge(seat)}
            </span>
            <span className="ally-seat__holder">{seat.assigneeEmail ?? PLAN.seats.free}</span>
            <span className="ally-seat__meta">
              {seat.kind === "extra" && seat.nextRenewal
                ? PLAN.seats.renews(longDay(seat.nextRenewal))
                : PLAN.seats.since(longDay(seat.startDate))}
            </span>
            {assigning && <SeatAssign seat={seat} index={index} assigning={assigning} />}
          </div>
          <Meter label={PLAN.seats.messages} bar={seat.messages} />
        </li>
      ))}
    </ul>
  );
};
