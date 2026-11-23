import type { LearnerUsageStatus } from "@types";

/**
 * Learner status colours, shared by the status bar, the attention list and the
 * learner table so one status always looks the same on the page. Colour is
 * never the only signal: every use also shows the status in words.
 */
export const STATUS_STYLE: Record<
  LearnerUsageStatus,
  { bar: string; chipBg: string; chipFg: string; labelKey: string }
> = {
  active: {
    bar: "#2a5db0",
    chipBg: "#dce6f6",
    chipFg: "#1c3a6e",
    labelKey: "organizationMetrics.learnerUsage.status.active",
  },
  at_risk: {
    bar: "#c98a1b",
    chipBg: "#f5e6c4",
    chipFg: "#6b4506",
    labelKey: "organizationMetrics.learnerUsage.status.atRisk",
  },
  dormant: {
    bar: "#b4490a",
    chipBg: "#f6e0d2",
    chipFg: "#7a3205",
    labelKey: "organizationMetrics.learnerUsage.status.dormant",
  },
  never_started: {
    bar: "#8f8a7e",
    chipBg: "#ece7da",
    chipFg: "#5a554b",
    labelKey: "organizationMetrics.learnerUsage.status.neverStarted",
  },
};

/** Order the statuses read in: most engaged first. */
export const STATUS_ORDER: LearnerUsageStatus[] = ["active", "at_risk", "dormant", "never_started"];
