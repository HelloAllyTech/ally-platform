import type {
  DebriefAgentMetrics,
  DebriefExperienceRates,
  DebriefMetricsView,
  DebriefMetricsWeek,
  DebriefPassBreakdownRow,
  DebriefRate,
} from "@types";

/*
 * Made-up but realistically shaped `GET /v1/debriefs/console/metrics` answers,
 * for the Debriefs tab's tests and for looking at the tab without a backend.
 * Nothing here comes from production.
 */

/** A rate with its counts and no server range (the browser computes Wilson). */
export const rate = (n: number, of: number): DebriefRate => ({ n, of, value: of ? n / of : null });

const exp = (scale = 1, tweak = 0): DebriefExperienceRates => ({
  openedWithin24h: rate(Math.round((17 + tweak) * scale), 20 * scale),
  readThrough: rate(Math.round((15 - tweak) * scale), 20 * scale),
  practiseClickThrough: rate(Math.round((4 + tweak) * scale), 20 * scale),
  reflectionAnswered: rate(Math.round(4 * scale), 20 * scale),
  abandonedBeforeReady: rate(Math.round(1 * scale), 20 * scale),
  flagsWithinSla: rate(Math.round(3 * scale), Math.round(3 * scale)),
  listened: rate(Math.round(2 * scale), 20 * scale),
  replied: rate(Math.round(6 * scale), 20 * scale),
});

const isoWeek = (i: number) => {
  const d = new Date(Date.UTC(2026, 7, 24) + i * 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const week = (i: number, debriefs: number): DebriefMetricsWeek => {
  const judged = Math.round(debriefs * 0.92);
  return {
    week: isoWeek(i),
    debriefs,
    steering: {
      value: 62 + i * 1.1,
      missing: i < 2 ? ["thumbs"] : [],
      components: { judge: 8.4 + i * 0.03, practise: rate(4, 20), thumbs: rate(8, 10) },
    },
    guardrails: {
      judgeP50: 8.6 + i * 0.02,
      judgeMean: 8.3 + i * 0.03,
      judged,
      hardFailRate: rate(Math.max(1, Math.round(judged * (0.11 - i * 0.004))), judged),
      fabricatedQuotes: i === 4 ? 1 : 0,
      thumbsDownRate: rate(2, 24),
      visibleSecondsP50: 68,
      visibleSecondsP90: 131,
      costP50: 0.071,
      costP90: 0.14,
      evaluatorJudgeGap: -0.3,
    },
    efficiency: {
      savedUsdMean: 0.41,
      revisionRoundsP50: 1,
      stepsP50: 9,
      within10Min: rate(debriefs - 1, debriefs),
    },
    experience: exp(debriefs / 20, i % 3),
  };
};

const group = (
  key: string,
  of: number,
  passShare: number,
  judge = 8.4,
): DebriefPassBreakdownRow => {
  const n = Math.round(of * passShare);
  const hf = Math.round(of * (1 - passShare) * 0.4);
  return {
    key,
    debriefs: of + 2,
    passRate: { ...rate(n, of) },
    outages: 0,
    unjudged: 1,
    hardFailRate: rate(hf, of),
    judgeMean: judge,
  };
};

const health = (ran: number, fails: number, p50: number, p90: number) => ({
  ran,
  failRate: rate(fails, ran),
  retryRate: rate(Math.round(fails * 1.5), ran),
  msP50: p50,
  msP90: p90,
});

export const agentsFixture = (runs = 412): DebriefAgentMetrics => ({
  stages: {
    runs,
    safetyReader: {
      ...health(runs, 3, 4200, 9800),
      riskCueRate: rate(58, runs),
      judgeMissDespiteCoverage: rate(4, 58),
    },
    analyst: health(runs, 6, 11200, 24800),
    progressReader: { ...health(runs, 2, 5100, 8800), unsupportedProgressRate: rate(9, 140) },
    guidanceLookup: {
      ran: runs,
      foundRate: rate(371, runs),
      passagesPerRunMean: 2.6,
      clinicalOnNoRiskRate: rate(11, 354),
      wrongLevelRate: rate(5, 371),
    },
    writer: {
      ...health(runs, 4, 18200, 31000),
      firstDraftPassRate: rate(289, runs),
      firstDraftFailures: [
        { code: "quote_mismatch", runs: 41 },
        { code: "too_long", runs: 33 },
        { code: "missing_try_saying", runs: 19 },
        { code: "wrong_language", runs: 8 },
      ],
    },
    reviser: {
      ...health(123, 2, 9100, 17400),
      fixRate: rate(97, 123),
      regressionRate: rate(7, 123),
      deadlineSkipRate: rate(5, 123),
    },
    evaluator: {
      ...health(runs, 1, 6200, 11800),
      missedRiskCue: {
        n: runs,
        both: 21,
        referenceOnly: 9,
        candidateOnly: 12,
        neither: 370,
        kappa: 0.62,
        recall: rate(21, 30),
        falseFlagRate: rate(12, 382),
      },
      heldOnItsOwnRate: rate(14, runs),
    },
    judge: { judgedRate: rate(380, runs), versions: ["gemini-2.5-pro/v3+g1"] },
    orchestrator: {
      runs: 236,
      planner: {
        ...health(236, 3, 2100, 4400),
        fallbackRate: rate(9, 236),
        timeoutRate: rate(4, 236),
        fallbackReasons: [
          { code: "planner_timeout", runs: 4 },
          { code: "planner_failed", runs: 3 },
          { code: "invalid_plan", runs: 2 },
        ],
        agentsChosenMean: 2.4,
        agentsChosenP50: 2,
        droppedForBudgetRate: rate(12, 236),
        droppedForTimeRate: rate(6, 236),
        droppedUnavailableRate: rate(2, 236),
        chosen: [
          { code: "guidance_lookup", runs: 201 },
          { code: "protocol_check", runs: 122 },
          { code: "history_deep", runs: 88 },
          { code: "language_specialist", runs: 61 },
          { code: "course_patterns", runs: 14 },
        ],
      },
      topUp: {
        reachedRate: rate(31, 236),
        addedRate: rate(24, 31),
        passAfterTopUpRate: rate(17, 24),
      },
      skippedThenMissed: {
        overall: rate(7, 96),
        byAgent: [
          { agent: "protocol_check", whenSkipped: rate(4, 40), whenChosen: rate(3, 122) },
          { agent: "language_specialist", whenSkipped: rate(3, 12), whenChosen: rate(2, 61) },
        ],
      },
      agents: [
        {
          agent: "analyst",
          floor: true,
          ...health(236, 4, 11000, 23000),
          offered: 236,
          chosenRate: rate(0, 0),
          findingsPerRunMean: 5.1,
          droppedQuoteRate: rate(14, 1203),
          usedByWriterRate: rate(820, 1203),
          judgedHardFailRate: rate(19, 220),
          topHardFails: [{ code: "invented_quote", runs: 6 }],
        },
        {
          agent: "protocol_check",
          floor: false,
          ...health(122, 1, 3900, 7200),
          offered: 162,
          chosenRate: rate(122, 162),
          findingsPerRunMean: 1.2,
          droppedQuoteRate: rate(2, 146),
          usedByWriterRate: rate(101, 146),
          judgedHardFailRate: rate(8, 114),
          topHardFails: [],
        },
        {
          agent: "course_patterns",
          floor: false,
          ...health(14, 0, 2600, 3900),
          offered: 30,
          chosenRate: rate(14, 30),
          findingsPerRunMean: 0.8,
          droppedQuoteRate: rate(0, 11),
          usedByWriterRate: rate(6, 11),
          judgedHardFailRate: rate(1, 13),
          topHardFails: [],
        },
      ],
      protocolCheck: {
        contradictsProtocolRate: rate(3, 114),
        contradictsProtocolWithoutRate: rate(4, 38),
        appliedRate: rate(77, 122),
        protocolNamedRate: rate(140, 146),
      },
      languageSpecialist: { sessions: 73, missWithRate: rate(2, 61), missWithoutRate: rate(3, 12) },
      historyDeep: {
        unsupportedProgressWithRate: rate(1, 80),
        unsupportedProgressWithoutRate: rate(5, 44),
      },
      aggregates: [
        {
          agent: "course_patterns",
          ran: 14,
          noQuoteRate: rate(11, 11),
          smallGroupRefusedRate: rate(3, 14),
        },
      ],
    },
  },
  askAlly: {
    replies: 188,
    questions: 201,
    checkPassRate: rate(171, 188),
    passRate: null,
    distressFlags: 2,
    modelCalls: 240,
    spendUsd: 3.6,
    costPerReplyMean: 0.03,
    costPerReplyTarget: 0.05,
  },
  pmAgent: {
    ideas: 13,
    screened: 4,
    gated: 1,
    promoted: 1,
    reverted: 0,
    rejected: 2,
    pending: 10,
    holdRate: rate(1, 1),
  },
});

const WEEKS = 12;
const COUNTS = [14, 22, 28, 31, 30, 34, 36, 33, 38, 41, 37, 40];

/** A full window: twelve weeks of live debriefs with every section filled in. */
export const fullView = (): DebriefMetricsView => {
  const series = Array.from({ length: WEEKS }, (_, i) => week(i, COUNTS[i]));
  const byWeek = series.map((w, i) => {
    const of = w.guardrails.judged;
    const pass = Math.round(of * (0.7 + i * 0.012));
    return {
      week: w.week,
      passRate: rate(pass, of),
      outages: i === 6 ? 2 : i === 9 ? 1 : 0,
      unjudged: i === WEEKS - 1 ? 3 : 0,
      hardFailRate: w.guardrails.hardFailRate,
      judgeMean: w.guardrails.judgeMean,
    };
  });
  return {
    weeks: WEEKS,
    weights: { judge: 0.5, practise: 0.25, thumbs: 0.25 },
    flagReviewSlaHours: 24,
    series,
    byLanguage: [
      { key: "en-IN", debriefs: 212, experience: exp(10, 1) },
      { key: "hi-IN", debriefs: 131, experience: exp(6, 0) },
      { key: "ta-IN", debriefs: 46, experience: exp(2, 2) },
      { key: "kn-IN", debriefs: 11, experience: exp(0.5, 0) },
    ],
    byPlatform: [
      { key: "android", debriefs: 251, experience: exp(12, 0) },
      { key: "ios", debriefs: 98, experience: exp(5, 1) },
      { key: "web", debriefs: 51, experience: exp(2, 2) },
    ],
    baselines: {
      from: "2026-07-01T00:00:00Z",
      until: "2026-08-01T00:00:00Z",
      legacyHardFailRate: rate(41, 300),
      legacyThumbsDownRate: rate(14, 200),
    },
    uptake: [
      { month: "2026-08", pairs: 64, lift: null, lower: null, upper: null, insufficient: true },
      { month: "2026-09", pairs: 171, lift: 0.04, lower: -0.05, upper: 0.13, insufficient: false },
      { month: "2026-10", pairs: 233, lift: 0.11, lower: 0.03, upper: 0.19, insufficient: false },
    ],
    safetyRecall: { recorded: false },
    quality: {
      byWeek,
      byLanguage: [
        { language: "en-IN", ...group("en-IN", 196, 0.81, 8.6) },
        { language: "hi-IN", ...group("hi-IN", 120, 0.74, 8.2) },
        { language: "ta-IN", ...group("ta-IN", 42, 0.67, 7.9) },
        { language: "kn-IN", ...group("kn-IN", 9, 0.56, 7.6) },
      ],
      bySegment: [
        {
          language: "en-IN",
          writerModel: "gemini-3-flash-preview",
          judgeVersion: "gemini-2.5-pro/v3+g1",
          ...group("a", 151, 0.83),
        },
        {
          language: "en-IN",
          writerModel: "gpt-5-mini",
          judgeVersion: "gemini-2.5-pro/v3+g1",
          ...group("b", 45, 0.73),
        },
        {
          language: "hi-IN",
          writerModel: "gemini-3-flash-preview",
          judgeVersion: "gemini-2.5-pro/v3+g1",
          ...group("c", 120, 0.74),
        },
        {
          language: "ta-IN",
          writerModel: "gemini-3-flash-preview",
          judgeVersion: "gemini-2.5-pro/v3+g1",
          ...group("d", 42, 0.67),
        },
        {
          language: "kn-IN",
          writerModel: "gemini-3-flash-preview",
          judgeVersion: "gemini-2.5-pro/v3+g1",
          ...group("e", 9, 0.56),
        },
      ],
      breakdowns: {
        skill: [
          ["Empathic reflection", 140, 0.82],
          ["Open questions", 122, 0.79],
          ["Safety assessment", 58, 0.69],
          ["Summarising", 97, 0.8],
          ["Validation", 88, 0.84],
          ["Goal setting", 41, 0.71],
          ["Psychoeducation", 36, 0.75],
          ["Silence and pacing", 22, 0.64],
          ["Closing the session", 31, 0.87],
          ["Normalising", 17, 0.76],
          ["Cultural sensitivity", 12, 0.58],
          ["Referral", 9, 0.67],
        ].map(([k, of, p]) => group(k as string, of as number, p as number)),
        scenario: [
          ["Exam stress", 61, 0.82],
          ["Grief after a parent's death", 44, 0.7],
          ["Panic at work", 52, 0.79],
          ["Family conflict over marriage", 38, 0.76],
          ["Self-harm disclosure", 27, 0.63],
          ["Postpartum low mood", 33, 0.73],
          ["Farmer debt and hopelessness", 21, 0.67],
          ["Substance use in a teen", 18, 0.61],
          ["Loneliness in old age", 29, 0.86],
          ["Domestic violence", 14, 0.57],
        ].map(([k, of, p]) => group(k as string, of as number, p as number)),
        course: [
          group("Foundations of counselling", 188, 0.8),
          group("Suicide prevention gatekeeper", 74, 0.69),
          group("Perinatal mental health", 33, 0.73),
        ],
        sessionLength: [
          group("6-15", 61, 0.66),
          group("16-30", 189, 0.78),
          group("31-60", 101, 0.83),
          group("61+", 16, 0.75),
        ],
        stepModel: [
          group("writer: gemini-3-flash-preview", 322, 0.79),
          group("writer: gpt-5-mini", 45, 0.73),
          group("safety_reader: gemini-3-flash-preview", 367, 0.78),
          group("safety_reader: gpt-5-mini (backup)", 6, 0.5),
        ],
        risk: [group("No risk cue", 309, 0.8), group("Risk cue", 58, 0.66)],
      },
    },
    agents: agentsFixture(),
    filterOptions: {
      organisations: [
        { id: "org-1", name: "Training partner A" },
        { id: "org-2", name: "Training partner B" },
      ],
      languages: ["en-IN", "hi-IN", "ta-IN", "kn-IN"],
      learnerLevels: ["lay", "early_professional"],
      recipes: ["standard", "short"],
      releaseVersions: [5, 4],
      judgeVersions: ["gemini-2.5-pro/v3+g1"],
      skills: ["Open questions", "Reflecting feelings"],
      scenarios: [{ id: 42, name: "Low mood after a job loss" }],
      courses: [{ id: 7, name: "Foundations" }],
      sessionLengths: ["6-15", "16-30"],
      stepModels: ["safety_reader: gemini-3-flash-preview", "writer: gemini-3-flash-preview"],
      risks: ["risk", "no_risk"],
    },
    generatedAt: "2026-11-10T00:00:00Z",
  };
};

/** Today's shape: every organisation is off, so nothing live in the window. */
export const emptyView = (): DebriefMetricsView => {
  const zero = rate(0, 0);
  const z = (i: number): DebriefMetricsWeek => ({
    ...week(i, 0),
    steering: {
      value: null,
      missing: [],
      components: { judge: null, practise: zero, thumbs: zero },
    },
    guardrails: {
      judgeP50: null,
      judgeMean: null,
      judged: 0,
      hardFailRate: zero,
      fabricatedQuotes: 0,
      thumbsDownRate: zero,
      visibleSecondsP50: null,
      visibleSecondsP90: null,
      costP50: null,
      costP90: null,
      evaluatorJudgeGap: null,
    },
    efficiency: { savedUsdMean: null, revisionRoundsP50: null, stepsP50: null, within10Min: zero },
    experience: exp(0),
  });
  const full = fullView();
  return {
    ...full,
    series: Array.from({ length: WEEKS }, (_, i) => z(i)),
    byLanguage: [],
    byPlatform: [],
    uptake: [],
    quality: { byWeek: [], byLanguage: [], bySegment: [] },
    agents: undefined,
    filterOptions: {
      organisations: [],
      languages: [],
      learnerLevels: [],
      recipes: [],
      releaseVersions: [],
      judgeVersions: [],
    },
  };
};
