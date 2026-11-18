import React from "react";

import { en } from "@constants";
import { RiskCueTestResult } from "@types";

/** A risk-cue test's outcome in plain words: passed, or the lines missed or wrongly flagged per run. */
export const RiskCueTestView: React.FC<{
  result: RiskCueTestResult;
  passedText: string;
  failedText: string;
}> = ({ result, passedText, failedText }) => {
  const s = en.debriefRoleplayOptions.dialog;
  const problems = result.reps.filter(r => r.missed.length > 0 || r.false_clear.length > 0);
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="risk-cue-test-result">
      <p className={result.passed ? "text-success-700" : "text-destructive-500"}>
        {result.passed ? passedText : failedText}
      </p>
      {!result.passed &&
        problems.map(r => (
          <div key={r.rep} className="flex flex-col gap-0.5">
            <span className="font-medium">{s.run(r.rep)}</span>
            {r.missed.map(line => (
              <span key={`m-${line}`} className="text-[13px]">
                {s.missed(line)}
              </span>
            ))}
            {r.false_clear.map(line => (
              <span key={`f-${line}`} className="text-[13px]">
                {s.wrong(line)}
              </span>
            ))}
          </div>
        ))}
    </div>
  );
};
