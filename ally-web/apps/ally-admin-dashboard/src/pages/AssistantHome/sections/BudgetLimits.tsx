import React, { useState } from "react";

import {
  useGetChatbotBudgetQuery,
  useSetChatbotBudgetMutation,
  useSetChatbotUserLimitsMutation,
  useTopUpChatbotBudgetMutation,
} from "@api";
import type { ChatbotBudgetResult } from "@api";
import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";

import { BUDGET_COPY as C } from "../../Credits/copy";
import { money, parseDollars } from "../../Credits/format";
import { Group } from "../fields";

import type { SectionProps } from "./props";

/** The free balance a budget change should leave, when the server doesn't say. */
export const FREE_BALANCE_RESERVE_USD = 5;

type Note = { ok: boolean; text: string } | null;

const limitText = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n);

type BudgetData = NonNullable<ReturnType<typeof useGetChatbotBudgetQuery>["data"]>;

/** Settings -> Budget and limits (stage 6): what is set aside for customers, and per-person limits. */
export const BudgetLimits: React.FC<SectionProps> = props => {
  const { bot } = props;
  const { data, isError } = useGetChatbotBudgetQuery(bot.id);

  if (isError) {
    return (
      <Group title={C.title} testId="settings-budget">
        <p className="ally-error" role="alert">
          {C.loadFailed}
        </p>
      </Group>
    );
  }
  if (!data)
    return (
      <Group title={C.title} hint={C.hint} testId="settings-budget">
        <p />
      </Group>
    );
  // Keyed by what the server holds, so the boxes start from it again whenever it changes.
  return (
    <BudgetForm key={JSON.stringify([data.setAsideUsd, data.userLimits])} {...props} data={data} />
  );
};

const BudgetForm: React.FC<SectionProps & { data: BudgetData }> = ({ bot, canManage, data }) => {
  const [setBudget] = useSetChatbotBudgetMutation();
  const [topUp] = useTopUpChatbotBudgetMutation();
  const [saveLimits] = useSetChatbotUserLimitsMutation();
  const [add, setAdd] = useState("");
  const [total, setTotal] = useState(String(data.setAsideUsd));
  const [daily, setDaily] = useState(limitText(data.userLimits.dailyUsd));
  const [weekly, setWeekly] = useState(limitText(data.userLimits.weeklyUsd));
  const [monthly, setMonthly] = useState(limitText(data.userLimits.monthlyUsd));
  const [note, setNote] = useState<Note>(null);
  const [limitNote, setLimitNote] = useState<Note>(null);

  const reserve = data.reserveUsd ?? FREE_BALANCE_RESERVE_USD;
  const free = data.freeBalanceUsd;
  const out = data.hasBudget && data.remainingUsd <= 0;

  /** The free balance this change leaves, as a warning when it is under the reserve. */
  const warnFor = (leaves: number | null): string | null =>
    leaves !== null && leaves < reserve ? C.warn(money(reserve), money(Math.max(0, leaves))) : null;

  const finish = (result: ChatbotBudgetResult, leaves: number | null) => {
    const text = [result.clamped ? C.clamped : C.saved, result.warning ?? warnFor(leaves)]
      .filter(Boolean)
      .join(" ");
    setNote({ ok: true, text });
  };

  const doTopUp = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = parseDollars(add);
    if (amount === null || Number.isNaN(amount) || amount <= 0)
      return setNote({ ok: false, text: C.topUp.invalid });
    if (free !== null && amount > free)
      return setNote({ ok: false, text: C.topUp.over(money(free)) });
    try {
      const result = await topUp({ id: bot.id, amountUsd: amount }).unwrap();
      setAdd("");
      finish(result, free === null ? null : free - amount);
    } catch {
      setNote({ ok: false, text: C.failed });
    }
  };

  const doSet = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = parseDollars(total);
    if (amount === null || Number.isNaN(amount) || amount < 0)
      return setNote({ ok: false, text: C.setAside.invalid });
    try {
      const result = await setBudget({ id: bot.id, setAsideUsd: amount }).unwrap();
      finish(result, free === null ? null : free - (amount - data.setAsideUsd));
    } catch {
      setNote({ ok: false, text: C.failed });
    }
  };

  const doLimits = async (event: React.FormEvent) => {
    event.preventDefault();
    const values = [daily, weekly, monthly].map(parseDollars);
    if (values.some(v => v !== null && (Number.isNaN(v) || v < 0)))
      return setLimitNote({ ok: false, text: C.limits.invalid });
    try {
      await saveLimits({
        id: bot.id,
        dailyUsd: values[0],
        weeklyUsd: values[1],
        monthlyUsd: values[2],
      }).unwrap();
      setLimitNote({ ok: true, text: C.saved });
    } catch {
      setLimitNote({ ok: false, text: C.failed });
    }
  };

  const noteView = (n: Note, testId: string) =>
    n && (
      <p
        className={n.ok ? "ally-field__hint" : "ally-error"}
        role={n.ok ? "status" : "alert"}
        data-testid={testId}
      >
        {n.text}
      </p>
    );

  return (
    <Group title={C.title} hint={C.hint} testId="settings-budget">
      {!data.hasBudget && (
        <p className="ally-body" role="status" data-testid="budget-none">
          <strong>{C.noBudget.title}.</strong> {C.noBudget.body}
        </p>
      )}
      {out && (
        <p className="ally-body" role="status" data-testid="budget-out">
          <strong>{C.out.title}.</strong> {C.out.body}
        </p>
      )}
      <dl className="ally-home__facts" data-testid="budget-current">
        <div>
          <dt>{C.current.setAside}</dt>
          <dd data-testid="budget-set-aside">{money(data.setAsideUsd)}</dd>
        </div>
        <div>
          <dt>{C.current.used}</dt>
          <dd data-testid="budget-used">{money(data.spentUsd)}</dd>
        </div>
        {/* TF1 round 2, N-12: Left is what is set aside less what is used and what replies
            in progress hold, so the line adds up. */}
        {data.reservedUsd >= 0.005 && (
          <div>
            <dt>{C.current.held}</dt>
            <dd data-testid="budget-held">{money(data.reservedUsd)}</dd>
          </div>
        )}
        <div>
          <dt>{C.current.left}</dt>
          <dd data-testid="budget-left">{money(data.remainingUsd)}</dd>
        </div>
        {free !== null && (
          <div>
            <dt>{C.current.free}</dt>
            <dd data-testid="budget-free">{money(free)}</dd>
          </div>
        )}
      </dl>

      {canManage && (
        <>
          <form onSubmit={doTopUp} noValidate>
            <label className="ally-field__label" htmlFor={`budget-add-${bot.id}`}>
              {C.topUp.label}
            </label>
            <Input
              id={`budget-add-${bot.id}`}
              className="!w-full"
              inputMode="decimal"
              placeholder={C.topUp.placeholder}
              value={add}
              onChange={e => setAdd(e.target.value)}
            />
            <Button variant={ButtonVariant.SECONDARY} type="submit">
              {C.topUp.action}
            </Button>
          </form>
          <form onSubmit={doSet} noValidate>
            <label className="ally-field__label" htmlFor={`budget-total-${bot.id}`}>
              {C.setAside.label}
            </label>
            <Input
              id={`budget-total-${bot.id}`}
              className="!w-full"
              inputMode="decimal"
              value={total}
              onChange={e => setTotal(e.target.value)}
            />
            <p className="ally-field__hint">{C.setAside.hint}</p>
            <Button variant={ButtonVariant.SECONDARY} type="submit">
              {C.setAside.action}
            </Button>
          </form>
          {noteView(note, "budget-note")}

          <form onSubmit={doLimits} noValidate data-testid="budget-limits">
            <h4 className="ally-home__group-title">{C.limits.title}</h4>
            <p className="ally-field__hint">{C.limits.hint}</p>
            {(
              [
                ["daily", C.limits.daily, daily, setDaily],
                ["weekly", C.limits.weekly, weekly, setWeekly],
                ["monthly", C.limits.monthly, monthly, setMonthly],
              ] as const
            ).map(([key, label, value, set]) => (
              <div key={key}>
                <label className="ally-field__label" htmlFor={`limit-${key}-${bot.id}`}>
                  {label}
                </label>
                <Input
                  id={`limit-${key}-${bot.id}`}
                  className="!w-full"
                  inputMode="decimal"
                  value={value}
                  onChange={e => set(e.target.value)}
                />
              </div>
            ))}
            <Button variant={ButtonVariant.SECONDARY} type="submit">
              {C.limits.action}
            </Button>
            {noteView(limitNote, "limits-note")}
          </form>
        </>
      )}
    </Group>
  );
};
