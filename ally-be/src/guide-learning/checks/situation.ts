/**
 * What a turn's situation report told Ally, read back from its text
 * (src/guide/conductor/situation-report.ts writes it). The report is the one
 * record of the budget, steer level and release window a reply was written
 * under, and it is in every trace payload and every Playground result, so
 * reading it here keeps production windows and replays on the same footing.
 */
export interface SituationFacts {
  mode: string | null;
  channel: 'text' | 'voice' | null;
  budget: { maxWords: number; maxSentences: number | null } | null;
  steerLevel: number | null;
  guidance: 'lead' | 'walk' | 'drive' | null;
  releaseWindowOpen: boolean;
  quizOpen: boolean;
  platformTurn: boolean;
}

export function readSituation(
  report: string | null | undefined,
): SituationFacts {
  const text = report ?? '';
  const budget = text.match(
    /reply budget: at most (\d+) words(?: and (\d+) sentences)?/,
  );
  const channel = text.match(/channel: (text|voice)/)?.[1] ?? null;
  const steer = text.match(/steer: level (\d)/)?.[1];
  const dial = text.match(/\(guidance: ([^)]+)\)/)?.[1]?.toLowerCase();
  const guidance =
    dial === 'lead me'
      ? 'lead'
      : dial === 'walk with me'
        ? 'walk'
        : dial === "i'll drive"
          ? 'drive'
          : null;
  return {
    mode: text.match(/^mode: ([A-Z_]+)/m)?.[1] ?? null,
    channel: channel as SituationFacts['channel'],
    budget: budget
      ? {
          maxWords: Number(budget[1]),
          maxSentences: budget[2] ? Number(budget[2]) : null,
        }
      : null,
    steerLevel: steer === undefined ? null : Number(steer),
    guidance,
    releaseWindowOpen: /^Release window:/m.test(text),
    quizOpen: /^A quiz is open:/m.test(text),
    platformTurn: /This turn was started by the platform/.test(text),
  };
}
