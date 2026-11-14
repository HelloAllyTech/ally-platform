import React, { useEffect, useMemo, useState } from "react";

import { listRefusalOf, useRepeatWeeklyMutation } from "@api";
import { Button, Chip, DatePicker, Select, TimePicker } from "@components/v2";
import type { Chatbot, ListField, ListRefusal, RepeatWeeklyResult, UserList } from "@types";

import { HOME, fill } from "../copy";
import { FieldInput } from "./EntryForm";
import { formatDate, liveFields, lower, noYear, todayIn } from "./format";

const t = () => HOME.userLists;
const STEPS = [15, 20, 30, 45, 60, 90, 120];
/** The most it adds at once (ally-be's cap). */
export const REPEAT_MAX = 500;

const addDays = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/** Next week's Sunday: the default end (so "fill next week" is one tap). */
const endOfNextWeek = (today: string): string => {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon 0
  return addDays(today, 13 - weekday);
};

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** The list's other details, which every new entry gets: not the time, not whose entry it is. */
export const otherDetails = (list: UserList, field: ListField): ListField[] =>
  liveFields(list).filter(f => f.key !== field.key && f.key !== list.settings.person_field);

/**
 * Repeat weekly until (chunk 5b): days, a start and end time, every N minutes and an end date,
 * then "For each one": the list's other details, from their defaults (Practitioner, Duration,
 * Open). One batch is one practitioner; owners repeat it for the next. Each change counts again
 * with a dry run ("This adds 32 slots. 3 are already there, so they're skipped.") and shows the
 * first few; Add them creates them in one go. Nothing about the repeat is stored.
 */
export const RepeatWeekly: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  field: ListField;
  onDone: (added: number) => void;
}> = ({ bot, list, lists, field, onDone }) => {
  const today = todayIn(list.time_zone);
  const details = otherDetails(list, field);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");
  const [every, setEvery] = useState(60);
  const [until, setUntil] = useState(endOfNextWeek(today));
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(details.map(f => [f.key, f.default ?? null])),
  );
  const [preview, setPreview] = useState<RepeatWeeklyResult | null>(null);
  const [refusal, setRefusal] = useState<ListRefusal | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [repeat, state] = useRepeatWeeklyMutation();

  const missing = details.filter(f => f.required && blank(values[f.key])).map(f => f.key);
  const given = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([, v]) => !blank(v))),
    [values],
  );
  const request = useMemo(
    () => ({
      id: bot.id,
      key: list.key,
      field: field.key,
      days: [...days].sort(),
      start,
      end,
      every_minutes: every,
      from: today,
      until,
      values: given,
    }),
    [bot.id, list.key, field.key, days, start, end, every, today, until, given],
  );
  const ready = days.length > 0 && start < end && until >= today;

  useEffect(() => {
    setPreview(null);
    setRefusal(null);
    setAdded(null);
    if (!ready || missing.length) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await repeat({ ...request, dry_run: true }).unwrap();
        if (live) setPreview(result);
      } catch (error) {
        if (live) setRefusal(listRefusalOf(error));
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, ready, missing.length]);

  const name = lower(list.name);
  const tooMany = refusal?.code === "limit_exceeded" || (preview?.count ?? 0) > REPEAT_MAX;
  const detailRefusal =
    refusal?.field && details.some(f => f.key === refusal.field) ? refusal : null;

  const add = async () => {
    setFailed(false);
    try {
      const result = await repeat({ ...request, dry_run: false }).unwrap();
      setAdded(result.count);
      onDone(result.count);
    } catch (error) {
      const found = listRefusalOf(error);
      if (found) setRefusal(found);
      else setFailed(true);
    }
  };

  let summary: React.ReactNode;
  if (added !== null) {
    summary = (
      <p className="ally-repeat__count is-done">
        {fill(t().repeat.added, { n: added, list: name })}
      </p>
    );
  } else if (tooMany) {
    summary = <p className="ally-error">{t().repeat.tooMany}</p>;
  } else if (refusal && !detailRefusal) {
    summary = <p className="ally-error">{refusal.message}</p>;
  } else if (missing.length) {
    summary = (
      <p className="ally-small">
        {fill(t().repeat.fillFirst, {
          detail: lower(details.find(f => f.key === missing[0])?.label ?? ""),
        })}
      </p>
    );
  } else if (!ready) {
    summary = <p className="ally-small">{t().repeat.nothing}</p>;
  } else if (!preview) {
    summary = <p className="ally-small">{t().repeat.checking}</p>;
  } else if (preview.count === 0) {
    summary = (
      <>
        <p className="ally-small">{t().repeat.nothing}</p>
        {preview.skipped > 0 && (
          <p className="ally-small">{fill(t().repeat.skipped, { n: preview.skipped })}</p>
        )}
      </>
    );
  } else {
    summary = (
      <>
        <p className="ally-repeat__count">
          {preview.count === 1
            ? t().repeat.countOne
            : fill(t().repeat.count, { n: preview.count, list: name })}
          {preview.skipped > 0 && (
            <span className="ally-repeat__skipped">
              {" "}
              {fill(t().repeat.skipped, { n: preview.skipped })}
            </span>
          )}
        </p>
        {preview.first.length > 0 && (
          <div className="ally-repeat__first">
            <span className="ally-small">{t().repeat.first}</span>
            <ul>
              {preview.first.map(line => (
                <li key={line}>{noYear(line)}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="ally-repeat" data-testid="repeat-weekly">
      <fieldset className="ally-field">
        <legend className="ally-field__label">{t().repeat.days}</legend>
        <div className="ally-chips">
          {t().repeat.weekdays.map((day, index) => {
            const n = index + 1;
            return (
              <Chip
                key={day}
                selected={days.includes(n)}
                onToggle={() => setDays(d => (d.includes(n) ? d.filter(x => x !== n) : [...d, n]))}
              >
                {day}
              </Chip>
            );
          })}
        </div>
      </fieldset>
      <div className="ally-repeat__row">
        <TimePicker label={t().repeat.from} value={start} onChange={setStart} />
        <TimePicker label={t().repeat.until} value={end} onChange={setEnd} />
        <Select
          label={t().repeat.every}
          value={String(every)}
          options={STEPS.map(n => ({
            value: String(n),
            label: n === 60 ? t().repeat.hour : fill(t().repeat.minutes, { n }),
          }))}
          onChange={v => setEvery(Number(v))}
        />
      </div>
      <DatePicker
        label={t().repeat.endDate}
        value={until}
        onChange={setUntil}
        labels={t().picker}
        format={formatDate}
        today={today}
      />

      {details.length > 0 && (
        <fieldset className="ally-repeat__each" data-testid="repeat-each">
          <legend className="ally-repeat__each-title">{t().repeat.forEach}</legend>
          <p className="ally-field__hint">{t().repeat.forEachHint}</p>
          {details.map(detail => (
            <FieldInput
              key={detail.key}
              bot={bot}
              list={list}
              lists={lists}
              field={detail}
              entry={null}
              value={values[detail.key]}
              current={null}
              disabled={state.isLoading && !state.originalArgs?.dry_run}
              refusal={detailRefusal?.field === detail.key ? detailRefusal : null}
              onChange={value => setValues(v => ({ ...v, [detail.key]: value }))}
            />
          ))}
        </fieldset>
      )}

      <div className="ally-repeat__result" aria-live="polite" data-testid="repeat-count">
        {summary}
      </div>
      {failed && (
        <p className="ally-error" role="alert">
          {t().form.failed}
        </p>
      )}
      {added === null && (
        <div className="ally-btn-row">
          <Button
            variant="primary"
            disabled={
              !preview || preview.count === 0 || tooMany || missing.length > 0 || state.isLoading
            }
            onClick={() => void add()}
          >
            {state.isLoading && !state.originalArgs?.dry_run ? t().repeat.adding : t().repeat.add}
          </Button>
        </div>
      )}
    </div>
  );
};
