import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  useAddSeatsMutation,
  useCancelSeatMutation,
  useChangeSeatTypeMutation,
  useGetPlansCatalogueQuery,
  useGetUserPlanQuery,
  useRenewSeatMutation,
  useSetUserPlanMutation,
} from "@api";
import type {
  AdminUserPlan,
  AssistantPlanUsage,
  BillingSeatType,
  PlanSeat,
  SubscriptionStatus,
  UsageBar,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";

import { compactCount, levelOf, longDay } from "../../Plan/format";
import { fill } from "../copy";
import { formatCount, todayIso } from "../money";
import { NoteConfirm, NoteConfirmRequest } from "../NoteConfirm";
import { PLANS } from "../plansCopy";
import { Field, inputClass } from "../SidePanel";
import { Column, DataTable, HistoryList, serverMessage } from "../Table";

const U = PLANS.userPlan;

/** "312 of 1,000" with a thin bar, in the admin look. */
export const AdminBar: React.FC<{ label: string; bar: UsageBar }> = ({ label, bar }) => {
  const level = levelOf(bar.used, bar.limit);
  const width = bar.limit ? Math.min(100, (bar.used / bar.limit) * 100) : 0;
  const tone =
    level === "full"
      ? "bg-destructive-500"
      : level === "high"
        ? "bg-warning-500"
        : "bg-primary-500";
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="text-typography-700">{label}</span>
        <span className="tabular-nums text-typography-900">
          {bar.limit === null
            ? `${formatCount(bar.used)} · ${PLANS.plans.unlimited}`
            : `${formatCount(bar.used)} of ${formatCount(bar.limit)}`}
        </span>
      </div>
      {bar.limit !== null && (
        <div className="h-1.5 rounded-full bg-background-secondary overflow-hidden">
          <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
        </div>
      )}
      <p className="text-xs text-typography-500">Resets {longDay(bar.resetsOn)}</p>
    </div>
  );
};

type Ask = (
  copy: { title: string; body: string },
  values: Record<string, string>,
  label: string,
  action: (note: string) => Promise<unknown>,
  success: string,
  destructive?: boolean,
) => void;

const AddSeatsForm: React.FC<{
  bot: AssistantPlanUsage;
  seatTypes: BillingSeatType[];
  ask: Ask;
  onDone: () => void;
}> = ({ bot, seatTypes, ask, onDone }) => {
  const [addSeats] = useAddSeatsMutation();
  const active = seatTypes.filter(type => type.active);
  const [type, setType] = useState(active[active.length - 1]?.key ?? "");
  const [count, setCount] = useState("1");
  const [start, setStart] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setError(U.badCount);
    setError(null);
    const typeName = seatTypes.find(t => t.key === type)?.name ?? type;
    ask(
      U.confirm.addSeats,
      { count: String(n), type: typeName, assistant: bot.name },
      U.addSeats,
      async note => {
        await addSeats({
          chatbotId: bot.chatbotId,
          seatTypeKey: type,
          count: n,
          startDate: start,
          note,
        }).unwrap();
        onDone();
      },
      U.toast.seats,
    );
  };
  return (
    <div
      className="rounded-md border border-border-light p-3 space-y-3"
      data-testid="add-seats-form"
    >
      <p className="text-sm font-medium">{U.addSeatsTitle(bot.name)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field id={`seat-type-${bot.chatbotId}`} label={U.seatType}>
          <select
            id={`seat-type-${bot.chatbotId}`}
            className={inputClass}
            value={type}
            onChange={event => setType(event.target.value)}
          >
            {active.map(t => (
              <option key={t.id} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`seat-count-${bot.chatbotId}`} label={U.count}>
          <input
            id={`seat-count-${bot.chatbotId}`}
            inputMode="numeric"
            className={inputClass}
            value={count}
            onChange={event => setCount(event.target.value)}
          />
        </Field>
        <Field id={`seat-start-${bot.chatbotId}`} label={U.startDate} help={U.startHelp}>
          <input
            id={`seat-start-${bot.chatbotId}`}
            type="date"
            className={inputClass}
            value={start}
            onChange={event => setStart(event.target.value)}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-500">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={ButtonVariant.PRIMARY} onClick={save}>
          {U.addSeats}
        </Button>
        <Button variant={ButtonVariant.SECONDARY} onClick={onDone}>
          {PLANS.form.cancel}
        </Button>
      </div>
    </div>
  );
};

const AssistantSeatsAdmin: React.FC<{
  bot: AssistantPlanUsage;
  seatTypes: BillingSeatType[];
  ask: Ask;
}> = ({ bot, seatTypes, ask }) => {
  const [adding, setAdding] = useState(false);
  const [renew] = useRenewSeatMutation();
  const [cancel] = useCancelSeatMutation();
  const [changeType] = useChangeSeatTypeMutation();

  const columns: Column<PlanSeat>[] = [
    { key: "type", label: U.seatType, cell: s => s.typeName },
    {
      key: "kind",
      label: "Included or extra",
      cell: s => (s.kind === "extra" ? "Extra" : "Included"),
    },
    { key: "holder", label: "Assigned to", cell: s => s.assigneeEmail ?? "—" },
    { key: "start", label: "Start", cell: s => longDay(s.startDate) },
    {
      key: "renewal",
      label: "Next renewal",
      cell: s => (s.nextRenewal ? longDay(s.nextRenewal) : "—"),
    },
    { key: "status", label: "Status", cell: s => s.status },
    {
      key: "messages",
      label: "Messages",
      numeric: true,
      cell: s =>
        s.messages.limit === null
          ? `${formatCount(s.messages.used)} · ${PLANS.plans.unlimited}`
          : `${formatCount(s.messages.used)} of ${formatCount(s.messages.limit)}`,
    },
    {
      key: "actions",
      label: "",
      cell: s =>
        s.status === "cancelled" ? null : (
          <span className="flex flex-wrap items-center gap-3 whitespace-nowrap">
            {s.kind === "extra" && (
              <button
                type="button"
                className="underline text-primary-600 min-h-[32px]"
                onClick={() =>
                  ask(
                    U.confirm.renew,
                    {},
                    U.renew,
                    note => renew({ seatId: s.id, note }).unwrap(),
                    U.toast.renewed,
                  )
                }
              >
                {U.renew}
              </button>
            )}
            <select
              aria-label={U.changeType}
              className="border border-border-light rounded-md px-2 py-1 text-sm bg-white"
              value={s.typeKey}
              onChange={event => {
                const key = event.target.value;
                const typeName = seatTypes.find(t => t.key === key)?.name ?? key;
                ask(
                  U.confirm.type,
                  { type: typeName },
                  U.changeType,
                  note => changeType({ seatId: s.id, seatTypeKey: key, note }).unwrap(),
                  U.toast.type,
                );
              }}
            >
              {seatTypes.map(t => (
                <option key={t.id} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            {s.kind === "extra" && (
              <button
                type="button"
                className="underline text-destructive-500 min-h-[32px]"
                onClick={() =>
                  ask(
                    U.confirm.cancel,
                    {},
                    U.cancelSeat,
                    note => cancel({ seatId: s.id, note }).unwrap(),
                    U.toast.cancelled,
                    true,
                  )
                }
              >
                {U.cancelSeat}
              </button>
            )}
          </span>
        ),
    },
  ];

  return (
    <div
      className="space-y-3 border-t border-border-light pt-4 first:border-t-0 first:pt-0"
      data-testid="user-plan-assistant"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-typography-900 break-words">{bot.name}</p>
          <p className="text-sm text-typography-600">
            {bot.seatSummary}
            {bot.unassigned ? ` · ${bot.unassigned} not given to anyone` : ""}
          </p>
        </div>
        {!adding && (
          <Button variant={ButtonVariant.TERTIARY} onClick={() => setAdding(true)}>
            {U.addSeats}
          </Button>
        )}
      </div>
      {adding && (
        <AddSeatsForm bot={bot} seatTypes={seatTypes} ask={ask} onDone={() => setAdding(false)} />
      )}
      <DataTable columns={columns} rows={bot.seats} rowKey={s => s.id} empty="No seats." />
      <AdminBar label="Customer conversations" bar={bot.customers} />
    </div>
  );
};

/** The plan, given the data (also drawn by the tests). */
export const UserPlanView: React.FC<{
  plan: AdminUserPlan;
  userId: number;
  name: string;
}> = ({ plan, userId, name }) => {
  const { data: catalogue } = useGetPlansCatalogueQuery();
  const [setPlan] = useSetUserPlanMutation();
  const [confirm, setConfirm] = useState<NoteConfirmRequest | null>(null);
  const sub = plan.subscription ?? null;
  const [draft, setDraft] = useState({
    planKey: sub?.planKey ?? plan.plan?.key ?? "",
    status: (sub?.status ?? "active") as SubscriptionStatus,
    periodStart: sub?.periodStart?.slice(0, 10) ?? plan.period?.start ?? todayIso(),
    periodEnd: sub?.periodEnd?.slice(0, 10) ?? "",
  });
  useEffect(() => {
    setDraft({
      planKey: sub?.planKey ?? plan.plan?.key ?? "",
      status: (sub?.status ?? "active") as SubscriptionStatus,
      periodStart: sub?.periodStart?.slice(0, 10) ?? plan.period?.start ?? todayIso(),
      periodEnd: sub?.periodEnd?.slice(0, 10) ?? "",
    });
  }, [
    sub?.planKey,
    sub?.status,
    sub?.periodStart,
    sub?.periodEnd,
    plan.plan?.key,
    plan.period?.start,
  ]);

  const ask: Ask = (copy, values, label, action, success, destructive = false) =>
    setConfirm({
      title: copy.title,
      description: fill(copy.body, values),
      confirmLabel: label,
      destructive,
      onConfirm: async note => {
        try {
          await action(note);
          toast.success(success);
        } catch (failure) {
          toast.error(serverMessage(failure, PLANS.failed));
          throw failure;
        }
      },
    });

  if (!plan.isCreator) {
    return (
      <p className="text-sm text-typography-600" data-testid="user-plan-not-creator">
        {U.notCreator}
      </p>
    );
  }

  const plans = catalogue?.plans ?? [];
  const seatTypes = catalogue?.seatTypes ?? [];
  const planName = plans.find(p => p.key === draft.planKey)?.name ?? draft.planKey;

  return (
    <div className="space-y-5" data-testid="user-plan">
      <div className="rounded-md border border-border-light p-3 md:p-4 space-y-3">
        <p className="text-lg text-typography-900 break-words" data-testid="user-plan-line">
          {plan.plan?.line}
        </p>
        {plan.period && (
          <p className="text-sm text-typography-600">
            {U.period(longDay(plan.period.start), longDay(plan.period.end))}
          </p>
        )}
        {!sub && <p className="text-sm text-typography-500">{U.noSubscription}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field id="user-plan-key" label={U.plan}>
            <select
              id="user-plan-key"
              className={inputClass}
              value={draft.planKey}
              onChange={event => setDraft({ ...draft, planKey: event.target.value })}
            >
              {plans.map(p => (
                <option key={p.id} value={p.key} disabled={!p.active && p.key !== draft.planKey}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="user-plan-status" label={U.status}>
            <select
              id="user-plan-status"
              className={inputClass}
              value={draft.status}
              onChange={event =>
                setDraft({ ...draft, status: event.target.value as SubscriptionStatus })
              }
            >
              {Object.entries(U.statuses).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="user-plan-start" label={U.periodStart}>
            <input
              id="user-plan-start"
              type="date"
              className={inputClass}
              value={draft.periodStart}
              onChange={event => setDraft({ ...draft, periodStart: event.target.value })}
            />
          </Field>
          <Field id="user-plan-end" label={U.periodEnd} help={U.periodEndHelp}>
            <input
              id="user-plan-end"
              type="date"
              className={inputClass}
              value={draft.periodEnd}
              onChange={event => setDraft({ ...draft, periodEnd: event.target.value })}
            />
          </Field>
        </div>
        <Button
          variant={ButtonVariant.PRIMARY}
          disabled={!draft.planKey}
          onClick={() =>
            ask(
              U.confirmPlan,
              { user: name, plan: planName },
              U.setPlan,
              note =>
                setPlan({
                  userId,
                  planKey: draft.planKey,
                  status: draft.status,
                  periodStart: draft.periodStart || undefined,
                  periodEnd: draft.periodEnd || null,
                  note,
                }).unwrap(),
              U.toast.plan,
            )
          }
          data-testid="user-plan-save"
        >
          {U.setPlan}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-border-light p-3 md:p-4">
        {plan.ownerRuns && <AdminBar label={U.ownerRuns} bar={plan.ownerRuns} />}
        <div className="min-w-0 text-sm">
          <p className="text-typography-700">{U.tokens}</p>
          <p className="text-typography-900">
            {plan.tokens
              ? plan.tokens.unlimited
                ? PLANS.plans.unlimited
                : `${compactCount(plan.tokens.left)} of ${compactCount(plan.tokens.granted)} left`
              : "—"}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-medium text-typography-900">{U.assistants}</h4>
        {plan.assistants?.length ? (
          plan.assistants.map(bot => (
            <AssistantSeatsAdmin key={bot.chatbotId} bot={bot} seatTypes={seatTypes} ask={ask} />
          ))
        ) : (
          <p className="text-sm text-typography-500">{U.noAssistants}</p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-typography-900">{U.history}</h4>
        <HistoryList entries={plan.history ?? []} empty={U.noHistory} />
      </div>
      <NoteConfirm request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

/**
 * Ally admin → a user → Plan (CR1 §C3): only chatbot creators have one. Set the plan and period;
 * per assistant, its seats (add, renew, cancel, change type) and this period's counters; the
 * history. Every change needs a note.
 */
export const UserPlan: React.FC<{ userId: number; name: string }> = ({ userId, name }) => {
  const { data, isLoading, isError } = useGetUserPlanQuery(userId);
  if (isLoading) return <p className="text-sm text-typography-500">{U.loading}</p>;
  if (isError || !data) return <p className="text-sm text-destructive-500">{U.loadFailed}</p>;
  return <UserPlanView plan={data} userId={userId} name={name} />;
};
