import React, { useEffect, useMemo, useState } from "react";

import { useRepeatWeeklyMutation } from "@api";
import { Button, Chip, DatePicker, Select, TimePicker } from "@components/v2";
import type { ListField, RepeatWeeklyResult, UserList } from "@types";

import { HOME, fill } from "../copy";
import { formatDate, lower, todayIn } from "./format";

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

/**
 * Repeat weekly until (chunk 5b): days, a start and end time, every N minutes and an end date.
 * Each change counts again with a dry run ("This adds 35 slots") and shows the first few; Add
 * them creates them in one go. Nothing about the repeat is stored: they're plain entries after.
 */
export const RepeatWeekly: React.FC<{
  botId: string;
  list: UserList;
  field: ListField;
  onDone: (added: number) => void;
  /** In the guided setup the step's own buttons move on; here it's Add them. */
  compact?: boolean;
}> = ({ botId, list, field, onDone }) => {
  const today = todayIn(list.time_zone);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("17:00");
  const [every, setEvery] = useState(60);
  const [until, setUntil] = useState(endOfNextWeek(today));
  const [preview, setPreview] = useState<RepeatWeeklyResult | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [repeat, state] = useRepeatWeeklyMutation();

  const request = useMemo(
    () => ({
      id: botId,
      key: list.key,
      field: field.key,
      days: [...days].sort(),
      start,
      end,
      every_minutes: every,
      from: today,
      until,
    }),
    [botId, list.key, field.key, days, start, end, every, today, until],
  );
  const ready = days.length > 0 && start < end && until >= today;

  useEffect(() => {
    setPreview(null);
    setAdded(null);
    if (!ready) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await repeat({ ...request, dry_run: true }).unwrap();
        if (live) setPreview(result);
      } catch {
        if (live) setPreview(null);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, ready]);

  const name = lower(list.name);
  const tooMany = (preview?.count ?? 0) > REPEAT_MAX;

  const add = async () => {
    setFailed(false);
    try {
      const result = await repeat({ ...request, dry_run: false }).unwrap();
      setAdded(result.count);
      onDone(result.count);
    } catch {
      setFailed(true);
    }
  };

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

      <div className="ally-repeat__result" aria-live="polite" data-testid="repeat-count">
        {added !== null ? (
          <p className="ally-repeat__count is-done">
            {fill(t().repeat.added, { n: added, list: name })}
          </p>
        ) : !ready ? (
          <p className="ally-small">{t().repeat.nothing}</p>
        ) : !preview ? (
          <p className="ally-small">{t().repeat.checking}</p>
        ) : tooMany ? (
          <p className="ally-error">{t().repeat.tooMany}</p>
        ) : preview.count === 0 ? (
          <p className="ally-small">{t().repeat.nothing}</p>
        ) : (
          <>
            <p className="ally-repeat__count">
              {preview.count === 1
                ? t().repeat.countOne
                : fill(t().repeat.count, { n: preview.count, list: name })}
            </p>
            {preview.skipped > 0 && (
              <p className="ally-small">{fill(t().repeat.skipped, { n: preview.skipped })}</p>
            )}
            {preview.first.length > 0 && (
              <div className="ally-repeat__first">
                <span className="ally-small">{t().repeat.first}</span>
                <ul>
                  {preview.first.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
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
            disabled={!preview || preview.count === 0 || tooMany || state.isLoading}
            onClick={() => void add()}
          >
            {state.isLoading && !state.originalArgs?.dry_run ? t().repeat.adding : t().repeat.add}
          </Button>
        </div>
      )}
    </div>
  );
};
