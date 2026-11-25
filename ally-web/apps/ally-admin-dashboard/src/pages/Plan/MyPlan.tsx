import React, { useState } from "react";

import { Link } from "react-router-dom";

import { useGetMyPlanQuery } from "@api";
import type { AssistantPlanUsage, MyPlan as MyPlanView } from "@api";
import { ROUTES } from "@constants";

import { PLAN } from "./copy";
import { usd } from "./format";
import { Meter, PlanAlertsBanner, SeatList } from "./ui";

import "../AssistantHome/ui/scale.css";
import "../WhatsAppBot/list-page.css";

const shareLink = (chatbotId: string) =>
  `${ROUTES.CHATBOT_DETAIL.replace(":botId", chatbotId)}?section=settings`;

/** "Ask Ally to upgrade": Ally sets plans for now, so it says how, rather than inventing a flow. */
const AskToUpgrade: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="ally-plan__upgrade">
      <button
        type="button"
        className="ally-btn ally-btn--secondary"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        data-testid="plan-upgrade"
      >
        {PLAN.upgrade.action}
      </button>
      {open && (
        <p className="ally-plan__note" role="note" style={{ marginTop: 10 }}>
          {PLAN.upgrade.how}
        </p>
      )}
    </div>
  );
};

const AssistantUsage: React.FC<{ bot: AssistantPlanUsage }> = ({ bot }) => (
  <section className="ally-plan__assistant" data-testid="plan-assistant">
    <div className="ally-plan__assistant-head">
      <h3 className="ally-plan__assistant-name">{bot.name}</h3>
      <span
        className={`ally-badge ${bot.status === "live" ? "ally-badge--good" : "ally-badge--muted"}`}
      >
        {bot.status === "live" ? PLAN.assistants.published : PLAN.assistants.draft}
      </span>
      <Link className="ally-small" to={shareLink(bot.chatbotId)} style={{ marginLeft: "auto" }}>
        {PLAN.assistants.open}
      </Link>
    </div>
    <p className="ally-small" style={{ margin: 0 }}>
      {bot.seatSummary}
      {bot.unassigned > 0 ? ` · ${PLAN.seats.unassigned(bot.unassigned)}` : ""}
    </p>
    <Meter label={PLAN.month.customers} bar={bot.customers} testId="plan-customers" />
    <SeatList seats={bot.seats} />
  </section>
);

/** The body, given the plan: also drawn by the tests and the e2e fixture. */
export const MyPlanBody: React.FC<{ plan: MyPlanView }> = ({ plan }) => (
  <div className="ally-plan" data-testid="my-plan">
    {plan.isCreator && plan.plan ? (
      <>
        <PlanAlertsBanner alerts={plan.alerts} />
        <section className="ally-plan__card" data-testid="plan-line">
          <div className="ally-plan__row">
            <div>
              <p className="ally-plan__line">{plan.plan.line}</p>
              {PLAN.status[plan.plan.status] && (
                <span className="ally-badge ally-badge--warn">{PLAN.status[plan.plan.status]}</span>
              )}
            </div>
          </div>
          <AskToUpgrade />
        </section>
      </>
    ) : (
      <p className="ally-plan__note" data-testid="plan-not-creator">
        {PLAN.notCreator}
      </p>
    )}

    {plan.isCreator && plan.monthlyUsage && (
      <section className="ally-plan__card" data-testid="plan-usage">
        <h2>{PLAN.usage.title}</h2>
        <div className="ally-plan__meters">
          <Meter
            label={PLAN.usage.label}
            bar={plan.monthlyUsage}
            format={usd}
            testId="plan-monthly-usage"
          />
        </div>
        <p className="ally-plan__note" data-testid="plan-usage-note">
          {plan.capReached ? PLAN.usage.stopped : PLAN.usage.stops}
        </p>
      </section>
    )}

    {plan.isCreator && plan.ownerRuns && (
      <section className="ally-plan__card" data-testid="plan-month">
        <h2>{PLAN.month.title}</h2>
        <div className="ally-plan__meters">
          <Meter
            label={PLAN.month.ownerRuns}
            hint={PLAN.month.ownerRunsHint}
            bar={plan.ownerRuns}
            testId="plan-owner-runs"
          />
        </div>
      </section>
    )}

    {plan.isCreator && (
      <section className="ally-plan__card" data-testid="plan-assistants">
        <h2>{PLAN.assistants.title}</h2>
        <p className="ally-small" style={{ margin: 0 }}>
          {PLAN.seats.hint}
        </p>
        {plan.assistants?.length ? (
          plan.assistants.map(bot => <AssistantUsage key={bot.chatbotId} bot={bot} />)
        ) : (
          <p className="ally-small">{PLAN.assistants.none}</p>
        )}
      </section>
    )}
  </div>
);

/**
 * The owner's Plan and usage (CR1 §C3), from the account menu: the plan, each assistant's seats
 * and this month's counts as plain bars. `MyPlanPanel` is the content alone, which the corner
 * menu's drawer also draws as its Seats and plan tab. The monthly usage allowance is the one amount in dollars:
 * what is used of it, when it resets, and that assistants stop answering when it is used up.
 */
export const MyPlanPanel: React.FC = () => {
  const { data, isLoading, isError } = useGetMyPlanQuery();
  return (
    <>
      {isLoading && <p className="ally-small">{PLAN.loading}</p>}
      {isError && (
        <p className="ally-error" role="alert">
          {PLAN.loadFailed}
        </p>
      )}
      {data && <MyPlanBody plan={data} />}
    </>
  );
};

export const MyPlan: React.FC = () => (
  <div className="ally-v2 ally-list-page" data-testid="my-plan-page">
    <header className="ally-list-page__head">
      <div className="ally-list-page__title">
        <h1 className="ally-display">{PLAN.title}</h1>
        <p className="ally-small">{PLAN.intro}</p>
      </div>
    </header>
    <MyPlanPanel />
  </div>
);

export default MyPlan;
