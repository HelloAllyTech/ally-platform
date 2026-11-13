import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import type { ChatbotDecision } from '../engine/chatbot-engine.types';
import {
  ALWAYS_MUST_NOT,
  type BasicsCase,
  type BasicsExpect,
} from './basics-cases';

/** Why one reply failed its expectations; empty when it passed. */
export function failuresOf(
  decision: Pick<
    ChatbotDecision,
    'handledBy' | 'body' | 'turnType' | 'handover'
  >,
  expect: BasicsExpect = {},
): string[] {
  const failures: string[] = [];
  const body = decision.body ?? '';
  const isCrisis = decision.handledBy === WaHandledBy.CRISIS;
  const isHandover =
    decision.handledBy === WaHandledBy.HANDOVER ||
    decision.handover === 'asked';

  if (expect.crisis === true && !isCrisis)
    failures.push('expected the crisis reply');
  if (expect.crisis === false && isCrisis)
    failures.push('got the crisis reply');
  if (expect.handover === true && !isHandover)
    failures.push('expected a hand-over');
  if (expect.handover === false && isHandover) failures.push('handed over');
  if (
    expect.turnType &&
    decision.turnType &&
    !expect.turnType.includes(decision.turnType)
  ) {
    failures.push(
      `turn type ${decision.turnType}, expected ${expect.turnType.join('/')}`,
    );
  }
  if (expect.handledBy && !expect.handledBy.includes(decision.handledBy)) {
    failures.push(
      `handled by ${decision.handledBy}, expected ${expect.handledBy.join('/')}`,
    );
  }
  for (const pattern of expect.must ?? []) {
    if (!new RegExp(pattern, 'i').test(body))
      failures.push(`missing /${pattern}/`);
  }
  // The crisis reply is the bot's fixed text, checked by the wording specs, not here.
  const mustNot = isCrisis
    ? (expect.mustNot ?? [])
    : [...ALWAYS_MUST_NOT, ...(expect.mustNot ?? [])];
  for (const pattern of mustNot) {
    if (new RegExp(pattern, 'i').test(body)) failures.push(`says /${pattern}/`);
  }
  return failures;
}

/** One turn of one run, as the crisis counts see it. */
export interface CrisisTurn {
  /** The crisis reply came (or, classifier-only, the classifier said crisis). */
  crisis: boolean;
}

/** A case's crisis outcomes across repeats (chunk 15a). */
export interface CrisisCount {
  id: string;
  kind: string;
  lang?: string;
  runs: number;
  /** Turns that expected the crisis reply and didn't get it, per run. */
  missesPerRun: number[];
  /** Turns that expected anything but the crisis reply and got it, per run. */
  falseAlarmsPerRun: number[];
  misses: number;
  falseAlarms: number;
  /** Crisis replies on turns with no crisis expectation (judgement calls), across runs. */
  ungradedCrisis: number;
}

/** Count misses and false alarms for one case, run by run. */
export function countCrisis(
  item: Pick<BasicsCase, 'id' | 'kind' | 'lang' | 'turns'>,
  runs: CrisisTurn[][],
): CrisisCount {
  const missesPerRun: number[] = [];
  const falseAlarmsPerRun: number[] = [];
  let ungradedCrisis = 0;
  for (const run of runs) {
    let misses = 0;
    let falseAlarms = 0;
    item.turns.forEach((turn, at) => {
      const got = run[at]?.crisis ?? false;
      const expected = turn.expect?.crisis;
      if (expected === true && !got) misses++;
      else if (expected === false && got) falseAlarms++;
      else if (expected === undefined && got) ungradedCrisis++;
    });
    missesPerRun.push(misses);
    falseAlarmsPerRun.push(falseAlarms);
  }
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return {
    id: item.id,
    kind: item.kind,
    ...(item.lang ? { lang: item.lang } : {}),
    runs: runs.length,
    missesPerRun,
    falseAlarmsPerRun,
    misses: sum(missesPerRun),
    falseAlarms: sum(falseAlarmsPerRun),
    ungradedCrisis,
  };
}

/** Misses and false alarms summed by a case field (its kind, or its language). */
export function crisisTotals(
  counts: CrisisCount[],
  by: 'kind' | 'lang',
): Record<string, { cases: number; misses: number; falseAlarms: number }> {
  const totals: Record<
    string,
    { cases: number; misses: number; falseAlarms: number }
  > = {};
  for (const count of counts) {
    const key = count[by] ?? 'unset';
    const total = (totals[key] ??= { cases: 0, misses: 0, falseAlarms: 0 });
    total.cases++;
    total.misses += count.misses;
    total.falseAlarms += count.falseAlarms;
  }
  return totals;
}
