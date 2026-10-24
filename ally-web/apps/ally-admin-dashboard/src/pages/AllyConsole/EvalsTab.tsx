import React, { useState } from "react";

import { ContentSwitcher, Switch } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { EvalCasesPanel } from "./EvalCasesPanel";
import { EvalRunsPanel } from "./EvalRunsPanel";
import { EvaluatorPanel } from "./EvaluatorPanel";
import { ReviewsPanel } from "./ReviewsPanel";

const VIEWS = ["evaluator", "reviews", "cases", "runs"] as const;
export type EvalsView = (typeof VIEWS)[number];

/**
 * The learning loop (plan §7.13, §10.5): a nightly evaluator reads a sample of conversations, people
 * label the ones that matter, saved cases become tests, and every release is replayed against them
 * before it goes live. Four views of one loop, kept in one tab so a person can follow a problem from
 * a flagged window to a case to the run that now guards against it.
 */
export const EvalsTab: React.FC<{ initialView?: EvalsView }> = ({ initialView = "evaluator" }) => {
  const strings = en.allyConsole.evals;
  const [view, setView] = useState<EvalsView>(initialView);

  return (
    <div className="flex flex-col gap-6" data-testid="ally-evals">
      <p className="max-w-3xl text-sm text-typography-700">{strings.intro}</p>
      <ContentSwitcher
        size="md"
        selectedIndex={VIEWS.indexOf(view)}
        onChange={(event: { name?: string | number }) => setView(event.name as EvalsView)}
        className="max-w-xl"
        aria-label={strings.viewLabel}
      >
        {VIEWS.map(name => (
          <Switch key={name} name={name} text={strings.views[name]} />
        ))}
      </ContentSwitcher>
      {view === "evaluator" && <EvaluatorPanel />}
      {view === "reviews" && <ReviewsPanel />}
      {view === "cases" && <EvalCasesPanel />}
      {view === "runs" && <EvalRunsPanel />}
    </div>
  );
};
