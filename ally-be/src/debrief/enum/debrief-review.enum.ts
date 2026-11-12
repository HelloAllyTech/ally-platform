/**
 * Expert review of Debrief agent debriefs (spec Part B). Every one backs a
 * CHECK in migration 1981900700000 (see check-constraints-cover-enums.spec.ts).
 */
export enum DebriefReviewVerdict {
  GOOD = 'good',
  NEEDS_WORK = 'needs_work',
}

/** What a comment is pinned to. */
export enum DebriefCommentAnchor {
  /** A span of one transcript turn. */
  TRANSCRIPT = 'transcript',
  /** A span of one card the learner read. */
  CARD = 'card',
  /** The debrief as a whole: a general comment. */
  DEBRIEF = 'debrief',
}

/** The optional tag on a comment (spec B2). */
export enum DebriefCommentTag {
  MISSED_MOMENT = 'missed_moment',
  WRONG_OR_UNSUPPORTED = 'wrong_or_unsupported',
  TONE = 'tone',
  ADVICE_DOESNT_FIT = 'advice_doesnt_fit',
  PROTOCOL = 'protocol',
  LANGUAGE = 'language',
  TOO_LONG_OR_UNCLEAR = 'too_long_or_unclear',
  GOOD_KEEP_THIS = 'good_keep_this',
}

export enum DebriefCommentStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

/**
 * The κ gate's measures, one yes/no question each under the expert verdict
 * (debrief-agreement.util.ts). Codes match the judge's: accuracy and
 * evidence_specificity are its dimensions, missed_risk_cue its hard fail.
 * Backs a CHECK in migration 1981900790000.
 */
export enum DebriefAgreementMeasure {
  ACCURACY = 'accuracy',
  EVIDENCE = 'evidence_specificity',
  MISSED_RISK_CUE = 'missed_risk_cue',
}
