import "@carbon/charts/styles.css";
import React, { useMemo, useState } from "react";

import { Link } from "react-router-dom";

import { useGetMyCreditsQuery } from "@api";
import type { CreditAccountView, MyCredits as MyCreditsView } from "@api";
import { SimpleBarChart } from "@components/charts";
import { ROUTES } from "@constants";

import { CREDITS_COPY as C } from "./copy";
import { money } from "./format";
import { PALETTE, hBarOpts, timeBarOpts } from "../Analytics/chartKit";
import { shortDay } from "../Plan/format";

import "../AssistantHome/ui/scale.css";
import "../Plan/plan.css";
import "../WhatsAppBot/list-page.css";

const Card: React.FC<{ title?: string; testId?: string; children: React.ReactNode }> = ({
  title,
  testId,
  children,
}) => (
  <section className="ally-plan__card" data-testid={testId}>
    {title && <h2>{title}</h2>}
    {children}
  </section>
);

const Figure: React.FC<{ label: string; value: string; hint?: string; testId: string }> = ({
  label,
  value,
  hint,
  testId,
}) => (
  <div data-testid={testId} style={{ minWidth: 140 }}>
    <p className="ally-small" style={{ margin: 0 }}>
      {label}
    </p>
    <p className="ally-display" style={{ margin: 0 }}>
      {value}
    </p>
    {hint && (
      <p className="ally-small" style={{ margin: 0 }}>
        {hint}
      </p>
    )}
  </div>
);

export const taskLabel = (task: string): string =>
  C.spend.tasks[task] ?? task.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** Spend by kind of work, by chatbot and by day. Dollars from the ledger; nothing per customer. */
export const SpendCharts: React.FC<{ view: CreditAccountView; testId?: string }> = ({
  view,
  testId = "credits-spend",
}) => {
  const byTask = useMemo(
    () =>
      view.spendByTask
        .filter(r => r.costUsd > 0)
        .map(r => ({ group: taskLabel(r.task), value: r.costUsd })),
    [view.spendByTask],
  );
  const byChatbot = useMemo(
    () =>
      view.spendByChatbot
        .filter(r => r.costUsd > 0)
        .map(r => ({
          group: r.name ?? (r.chatbotId ? C.spend.deleted : C.spend.other),
          value: r.costUsd,
        })),
    [view.spendByChatbot],
  );
  const byDay = useMemo(
    () =>
      view.spendByDay
        .filter(r => r.costUsd > 0)
        .map(r => ({ group: C.spend.axis, key: r.day.slice(5), value: r.costUsd })),
    [view.spendByDay],
  );
  const colour = { [C.spend.axis]: PALETTE.blue };
  const hOpts = useMemo(
    () => hBarOpts({ bottomTitle: C.spend.axis, colorScale: colour, height: "240px" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const dayOpts = useMemo(
    () => timeBarOpts({ leftTitle: C.spend.axis, colorScale: colour, height: "240px" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const none = byTask.length === 0 && byChatbot.length === 0 && byDay.length === 0;
  return (
    <Card title={C.spend.title} testId={testId}>
      {none ? (
        <p className="ally-small" data-testid="credits-spend-empty">
          {C.spend.empty}
        </p>
      ) : (
        <>
          {byTask.length > 0 && (
            <div data-testid="credits-spend-task">
              <h3 className="ally-small">{C.spend.byTask}</h3>
              <SimpleBarChart
                data={byTask.map(d => ({ ...d, group: d.group }))}
                options={
                  {
                    ...hOpts,
                    color: { scale: Object.fromEntries(byTask.map(d => [d.group, PALETTE.blue])) },
                  } as never
                }
              />
            </div>
          )}
          {byChatbot.length > 0 && (
            <div data-testid="credits-spend-chatbot">
              <h3 className="ally-small">{C.spend.byChatbot}</h3>
              <SimpleBarChart
                data={byChatbot}
                options={
                  {
                    ...hOpts,
                    color: {
                      scale: Object.fromEntries(byChatbot.map(d => [d.group, PALETTE.teal])),
                    },
                  } as never
                }
              />
            </div>
          )}
          {byDay.length > 0 && (
            <div data-testid="credits-spend-day">
              <h3 className="ally-small">{C.spend.byDay}</h3>
              <SimpleBarChart data={byDay} options={dayOpts as never} />
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export const GrantHistory: React.FC<{ grants: CreditAccountView["grants"]; title?: string }> = ({
  grants,
  title = C.grants.title,
}) => (
  <Card title={title} testId="credits-grants">
    {grants.length === 0 ? (
      <p className="ally-small">{C.grants.none}</p>
    ) : (
      <table className="ally-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th align="left">{C.grants.columns.when}</th>
            <th align="left">{C.grants.columns.kind}</th>
            <th align="right">{C.grants.columns.amount}</th>
            <th align="left">{C.grants.columns.note}</th>
            <th align="left">{C.grants.columns.by}</th>
          </tr>
        </thead>
        <tbody>
          {grants.map(g => (
            <tr key={g.id} data-testid="credits-grant-row">
              <td>{shortDay(g.at)}</td>
              <td>{C.grants.kinds[g.kind] ?? g.kind}</td>
              <td align="right">{money(g.amountUsd)}</td>
              <td>{g.note}</td>
              <td>{g.grantedBy ?? C.grants.ally}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const ContactAlly: React.FC = () => {
  const [asked, setAsked] = useState(false);
  return (
    <Card title={C.more.title} testId="credits-contact">
      <p className="ally-small" style={{ margin: 0 }}>
        {C.more.body}
      </p>
      <button
        type="button"
        className="ally-btn ally-btn--secondary"
        aria-describedby={asked ? "credits-contact-message" : undefined}
        data-testid="credits-contact-button"
        onClick={() => setAsked(true)}
      >
        {C.more.action}
      </button>
      {asked && (
        <p
          id="credits-contact-message"
          className="ally-plan__note"
          role="status"
          data-testid="credits-contact-message"
        >
          {C.more.reply}
        </p>
      )}
    </Card>
  );
};

/** The body, given the credits: also drawn by the tests. */
export const MyCreditsBody: React.FC<{ credits: MyCreditsView; hidePlanLink?: boolean }> = ({
  credits,
  hidePlanLink = false,
}) => {
  const hasAccount = credits.accountId !== null;
  const empty = hasAccount && credits.freeBalanceUsd <= 0;
  const low = hasAccount && !empty && credits.freeBalanceUsd < credits.reserveUsd;
  return (
    <div className="ally-plan" data-testid="my-credits">
      {!hasAccount && (
        <p className="ally-plan__note" data-testid="credits-none">
          {C.noAccount}
        </p>
      )}
      {(empty || low) && (
        <p className="ally-plan__note" role="status" data-testid="credits-low">
          <strong>{C.low.title}.</strong> {empty ? C.low.empty : C.low.body}
        </p>
      )}
      <Card testId="credits-totals">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          <Figure
            label={C.totals.granted}
            value={money(credits.grantedUsd)}
            testId="credits-granted"
          />
          <Figure label={C.totals.used} value={money(credits.usedUsd)} testId="credits-used" />
          <Figure
            label={C.totals.free}
            value={money(credits.freeBalanceUsd)}
            hint={C.totals.freeHint}
            testId="credits-free"
          />
          <Figure
            label={C.totals.setAside}
            value={money(credits.setAsideUsd)}
            hint={C.totals.setAsideHint}
            testId="credits-set-aside"
          />
        </div>
      </Card>

      {credits.pausedJobs.length > 0 && (
        <Card title={C.paused.title} testId="credits-paused">
          <p className="ally-small" style={{ margin: 0 }}>
            {C.paused.body}
          </p>
          <ul>
            {credits.pausedJobs.map(j => (
              <li key={`${j.kind}:${j.subjectId}:${j.reason}`}>
                {C.paused.jobs[j.kind] ?? taskLabel(j.kind)} · {C.paused.since(shortDay(j.since))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ContactAlly />
      <SpendCharts view={credits} />

      <Card title={C.budgets.title} testId="credits-budgets">
        {credits.budgets.length === 0 ? (
          <p className="ally-small">{C.budgets.none}</p>
        ) : (
          <table className="ally-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th align="left">{C.budgets.columns.chatbot}</th>
                <th align="right">{C.budgets.columns.setAside}</th>
                <th align="right">{C.budgets.columns.used}</th>
                <th align="right">{C.budgets.columns.left}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {credits.budgets.map(b => (
                <tr key={b.chatbotId} data-testid="credits-budget-row">
                  <td>
                    {b.name ?? C.spend.deleted}
                    {b.archived ? ` (${C.budgets.archived})` : ""}
                  </td>
                  <td align="right">{money(b.setAsideUsd)}</td>
                  <td align="right">{money(b.spentUsd)}</td>
                  <td align="right">{money(b.remainingUsd)}</td>
                  <td>
                    {!b.archived && (
                      <Link
                        className="ally-small"
                        to={`${ROUTES.CHATBOT_DETAIL.replace(":botId", b.chatbotId)}?section=settings`}
                      >
                        {C.budgets.open}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <GrantHistory grants={credits.grants} />
      {!hidePlanLink && (
        <p className="ally-small">
          <Link to={ROUTES.MY_PLAN} data-testid="credits-plan-link">
            {C.planLink}
          </Link>
        </p>
      )}
    </div>
  );
};

/** The credits content with its loading and failed states, no page header: the page and the
 *  corner menu's drawer both draw it. */
export const MyCreditsPanel: React.FC<{ hidePlanLink?: boolean }> = ({ hidePlanLink }) => {
  const { data, isLoading, isError } = useGetMyCreditsQuery();
  return (
    <>
      {isLoading && <p className="ally-small">{C.loading}</p>}
      {isError && (
        <p className="ally-error" role="alert">
          {C.loadFailed}
        </p>
      )}
      {data && <MyCreditsBody credits={data} hidePlanLink={hidePlanLink} />}
    </>
  );
};

/** `/account/credits`: the same content as the corner menu's Plan and credits tab, as a page. */
export const MyCredits: React.FC = () => (
  <div className="ally-v2 ally-list-page" data-testid="my-credits-page">
    <header className="ally-list-page__head">
      <div className="ally-list-page__title">
        <h1 className="ally-display">{C.title}</h1>
        <p className="ally-small">{C.intro}</p>
      </div>
    </header>
    <MyCreditsPanel />
  </div>
);

export default MyCredits;
