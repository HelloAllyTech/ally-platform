import React from "react";

import { PLANS } from "../plansCopy";
import { UserPlan } from "./UserPlan";
import { UserTokens } from "./UserTokens";

const Section: React.FC<{
  title: string;
  intro: string;
  testId: string;
  children: React.ReactNode;
}> = ({ title, intro, testId, children }) => (
  <section className="flex flex-col gap-2 min-w-0" data-testid={testId}>
    <div>
      <h3 className="text-base font-secondary text-typography-900">{title}</h3>
      <p className="text-sm text-typography-600">{intro}</p>
    </div>
    <div className="border border-border-light rounded-md p-3 md:p-4 min-w-0">{children}</div>
  </section>
);

/**
 * A user's Tokens and Plan (CR1 Parts B and C), on a custom login's page and an Ally admin's page.
 * The caller shows these only to holders of `manage_costs`; ally-be checks it too.
 */
export const UserBillingSections: React.FC<{ userId: number; name: string }> = ({
  userId,
  name,
}) => (
  <>
    <Section title={PLANS.tokens.title} intro={PLANS.tokens.intro} testId="user-tokens-section">
      <UserTokens userId={userId} name={name} />
    </Section>
    <Section title={PLANS.userPlan.title} intro={PLANS.userPlan.intro} testId="user-plan-section">
      <UserPlan userId={userId} name={name} />
    </Section>
  </>
);
