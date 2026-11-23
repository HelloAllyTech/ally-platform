import React from "react";

import { Button } from "@components/v2";

import { BUILD_COPY } from "./copy";
import { fill } from "../copy";

import type { WorkingCopy } from "./useWorkingCopy";

const P = BUILD_COPY.pending;

/**
 * After go-live (R3): edits are in the test chatbot at once and reach customers only on Apply.
 * Shows how many changes wait, and Apply, which runs the safety check when a safety-relevant
 * field changed; a refusal, an unavailable check or a $0 balance is said here and beside the field.
 */
export const PendingBar: React.FC<{ copy: WorkingCopy; disabled?: boolean }> = ({
  copy,
  disabled,
}) => {
  const { pending, applyState: a } = copy;
  const credits = Object.values(a.notApplied).some(code => code === "credits_required");
  const showResult = a.status !== "idle" && a.status !== "applying";
  if (!copy.live || (pending.length === 0 && !showResult)) return null;
  const applying = a.status === "applying";
  return (
    <div
      className="ally-build__pending"
      role="region"
      aria-label={P.apply}
      data-testid="pending-bar"
    >
      {pending.length > 0 && (
        <p className="ally-small">
          {pending.length === 1 ? P.one : fill(P.many, { n: pending.length })}
        </p>
      )}
      {a.status === "applied" && !credits && pending.length === 0 && (
        <p className="ally-small" role="status">
          {P.applied}
        </p>
      )}
      {credits && (
        <p className="ally-small" role="alert" data-testid="pending-credits">
          {P.creditsSome}
        </p>
      )}
      {a.warnings.map(w => (
        <p key={`${w.field}-${w.message}`} className="ally-small">
          {w.message}
        </p>
      ))}
      {a.status === "conflict" && (
        <p className="ally-error" role="alert" data-testid="pending-conflict">
          {fill(P.safetyConflict, { reason: a.reason ?? "" })}
        </p>
      )}
      {a.status === "unavailable" && (
        <p className="ally-error" role="alert" data-testid="pending-unavailable">
          {P.unavailable}
        </p>
      )}
      {a.status === "failed" && (
        <p className="ally-error" role="alert">
          {a.reason ?? P.failed}
        </p>
      )}
      {a.status === "notLive" && <p className="ally-small">{P.notLive}</p>}
      {pending.length > 0 && (
        <Button variant="primary" disabled={disabled || applying} onClick={() => void copy.apply()}>
          {applying ? P.applying : a.status === "unavailable" ? P.retry : P.apply}
        </Button>
      )}
    </div>
  );
};
