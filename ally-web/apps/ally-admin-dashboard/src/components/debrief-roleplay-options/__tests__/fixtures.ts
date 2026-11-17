import { RiskCueOption } from "@types";

export const riskCue = (over: Partial<RiskCueOption> = {}): RiskCueOption => ({
  id: "o1",
  key: "standard",
  name: "Standard",
  description: "The usual definition of a risk cue.",
  wording: null,
  handling: "alarm",
  wordListRaises: true,
  supportLinesOnCue: true,
  examples: { cues: [], nonCues: [] },
  status: "approved",
  version: 1,
  testResult: null,
  reviewNote: null,
  approvedAt: "2026-11-01T00:00:00.000Z",
  mine: false,
  ...over,
});

export const WORDING =
  "The character says something that suggests she may harm herself or someone else soon.";
