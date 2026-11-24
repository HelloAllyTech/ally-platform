import React from "react";

import { en } from "@constants";
import { RoleplayInterviewPlan } from "@types";

import { Button } from "../button";
import { ButtonVariant } from "../types";

interface RoleplayPlanCardProps {
  plan: RoleplayInterviewPlan;
  /** Absent once approved: the card is then a record. */
  onApprove?: () => void;
  approving?: boolean;
  approved?: boolean;
}

/**
 * The roleplay plan the trainer approves before anything is written (Course Copilot's blueprint,
 * for one roleplay): the character, the moments they must create, the states, what a pass looks
 * like and the supports for the mode. Changes are asked for in the chat.
 */
export const RoleplayPlanCard: React.FC<RoleplayPlanCardProps> = ({
  plan,
  onApprove,
  approving,
  approved,
}) => {
  const s = en.roleplayInterview.plan;
  const supports = [
    plan.supports?.remindersEnabled && en.agentBuilderMode.supports.reminders,
    plan.supports?.currentState && en.agentBuilderMode.supports.stateVisible,
    plan.supports?.supervisorNotesEnabled && en.agentBuilderMode.supports.supervisorNotes,
  ].filter(Boolean) as string[];
  return (
    <section
      className="w-full rounded-md border border-primary-200 bg-white p-4 text-sm"
      data-testid="roleplay-plan"
    >
      <p className="text-xs uppercase tracking-wide text-typography-500">
        {s.heading(plan.version)}
      </p>
      <h3 className="mt-1 text-base font-medium text-typography-900">{plan.title}</h3>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <h4 className="font-medium text-typography-900">{plan.characterSheet.name}</h4>
          <p className="text-typography-800">{plan.characterSheet.summary}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-typography-500">{s.hides}</dt>
            <dd className="text-typography-800">{plan.characterSheet.hides}</dd>
            <dt className="text-typography-500">{s.opensUpWhen}</dt>
            <dd className="text-typography-800">{plan.characterSheet.opensUpWhen}</dd>
            <dt className="text-typography-500">{s.speaks}</dt>
            <dd className="text-typography-800">{plan.characterSheet.speaks}</dd>
          </dl>
        </div>

        <div>
          <h4 className="font-medium text-typography-900">{s.moments}</h4>
          <ul className="list-disc pl-5 text-typography-800">
            {plan.moments.map(moment => (
              <li key={moment}>{moment}</li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-typography-900">{s.states}</h4>
          <ol className="flex flex-col gap-0.5 text-typography-800">
            {plan.states.map((state, index) => (
              <li key={`${state.name}-${index}`}>
                <span className="font-medium">{state.name}</span>
                <span className="text-typography-600"> — {state.guidelines}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h4 className="font-medium text-typography-900">{s.pass(plan.passCriteria.minScore)}</h4>
          <p className="text-typography-800">
            <span className="text-typography-500">{s.helpful} </span>
            {plan.passCriteria.helpful.join(", ")}
          </p>
          <p className="text-typography-800">
            <span className="text-typography-500">{s.unhelpful} </span>
            {plan.passCriteria.unhelpful.join(", ")}
          </p>
        </div>

        <p className="text-typography-800">
          <span className="text-typography-500">{s.opening} </span>“{plan.openingLine}”
        </p>
        <p className="text-typography-800">
          <span className="text-typography-500">{s.supports} </span>
          {supports.length ? supports.join(", ") : en.agentBuilderMode.supports.none}
        </p>
      </div>

      {approved ? (
        <p className="mt-3 text-xs font-medium text-success-700">✓ {s.approved}</p>
      ) : onApprove ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-typography-600">{s.changeHint}</p>
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={onApprove}
            disabled={approving}
            className="h-[40px] px-5"
          >
            {approving ? s.approving : s.approve}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
