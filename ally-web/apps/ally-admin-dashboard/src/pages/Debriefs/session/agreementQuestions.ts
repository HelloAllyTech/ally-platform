import { en } from "@constants";
import { AgreementMeasure, AgreementPrefillSource, AgreementQuestion } from "@types";

import { sectionLabel } from "../consoleLabels";

/** Hard fails that pre-fill a question as No (ally-be's debrief-agreement.util prefillAnswers). */
const HARD_FAIL_MEASURE: Record<string, AgreementMeasure> = {
  fabricated_quote: "accuracy",
  unsupported_progress_claim: "accuracy",
  missed_risk_cue: "missed_risk_cue",
};

export interface LiveQuestion {
  measure: AgreementMeasure;
  answer: boolean;
  /** Why it starts No (shown as a small note), or null. */
  source: AgreementPrefillSource | null;
}

/**
 * The questions as the panel shows them while the reviewer works: a saved answer stands; else the
 * server's comment-based pre-fill; else a hard fail ticked in the panel makes it No, as ally-be
 * will when the verdict is saved. An answer the reviewer set wins over all of these.
 */
export function liveQuestions(
  questions: readonly AgreementQuestion[],
  hardFails: readonly string[],
  touched: Partial<Record<AgreementMeasure, boolean>>,
): LiveQuestion[] {
  return questions.map(q => {
    const tickedCode = hardFails.find(code => HARD_FAIL_MEASURE[code] === q.measure);
    const source: AgreementPrefillSource | null =
      q.source?.kind === "comment"
        ? q.source
        : tickedCode
          ? { kind: "hard_fail", code: tickedCode }
          : null;
    const prefill = source === null;
    const answer = touched[q.measure] ?? q.saved ?? prefill;
    return { measure: q.measure, answer, source };
  });
}

/** "From your comment on turn 12", in words. */
export function sourceNote(source: AgreementPrefillSource | null): string | null {
  const a = en.debriefs.expertReview.verdict.agreement;
  if (!source) return null;
  if (source.kind === "hard_fail") return a.fromHardFail;
  if (source.anchorKind === "transcript" && source.turnIndex != null) {
    return a.fromTurn(source.turnIndex);
  }
  if (source.anchorKind === "card" && source.section) {
    return a.fromSection(sectionLabel(source.section).toLowerCase());
  }
  return a.fromDebrief;
}
