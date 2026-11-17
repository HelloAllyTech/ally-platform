import {
  RoleplayAttemptFailureReason,
  TrackItemCompletionLogic,
} from '../../type/track.type';
import {
  parseDefaultMinDurationSeconds,
  resolveRoleplayGate,
  roleplayCompletionLogic,
  roleplayFailureReasons,
} from '../roleplay-gate.util';

const { INSUFFICIENT_SCORE, INSUFFICIENT_DURATION } =
  RoleplayAttemptFailureReason;
const DEFAULT = 180;

describe('roleplayCompletionLogic', () => {
  it('reads an absent or unknown logic as SCORE_AND_DURATION (the pre-existing rule)', () => {
    expect(roleplayCompletionLogic(undefined)).toBe(
      TrackItemCompletionLogic.SCORE_AND_DURATION,
    );
    expect(roleplayCompletionLogic({})).toBe(
      TrackItemCompletionLogic.SCORE_AND_DURATION,
    );
    expect(roleplayCompletionLogic({ completionLogic: 'NOPE' as never })).toBe(
      TrackItemCompletionLogic.SCORE_AND_DURATION,
    );
  });

  it('keeps an explicit logic', () => {
    expect(
      roleplayCompletionLogic({
        completionLogic: TrackItemCompletionLogic.PARTICIPATION,
      }),
    ).toBe(TrackItemCompletionLogic.PARTICIPATION);
  });
});

describe('parseDefaultMinDurationSeconds', () => {
  it('parses the string the env var arrives as', () => {
    expect(parseDefaultMinDurationSeconds('180')).toBe(180);
    expect(parseDefaultMinDurationSeconds(90)).toBe(90);
  });
  it('reads unset or nonsense as no minimum', () => {
    expect(parseDefaultMinDurationSeconds(undefined)).toBe(0);
    expect(parseDefaultMinDurationSeconds('abc')).toBe(0);
    expect(parseDefaultMinDurationSeconds(-5)).toBe(0);
  });
});

describe('resolveRoleplayGate', () => {
  it('SCORE gates on score only', () => {
    expect(
      resolveRoleplayGate(
        {
          completionLogic: TrackItemCompletionLogic.SCORE,
          minScore: 60,
          minDurationSeconds: 90,
        },
        DEFAULT,
      ),
    ).toEqual({
      completionLogic: TrackItemCompletionLogic.SCORE,
      minScore: 60,
      minDurationSeconds: null,
    });
  });

  it('DURATION gates on duration only', () => {
    expect(
      resolveRoleplayGate(
        {
          completionLogic: TrackItemCompletionLogic.DURATION,
          minScore: 60,
          minDurationSeconds: 90,
        },
        DEFAULT,
      ),
    ).toEqual({
      completionLogic: TrackItemCompletionLogic.DURATION,
      minScore: null,
      minDurationSeconds: 90,
    });
  });

  it('SCORE_AND_DURATION gates on both', () => {
    expect(
      resolveRoleplayGate(
        {
          completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
          minScore: 60,
          minDurationSeconds: 90,
        },
        DEFAULT,
      ),
    ).toMatchObject({ minScore: 60, minDurationSeconds: 90 });
  });

  it('PARTICIPATION gates on nothing', () => {
    expect(
      resolveRoleplayGate(
        {
          completionLogic: TrackItemCompletionLogic.PARTICIPATION,
          minScore: 60,
          minDurationSeconds: 90,
        },
        DEFAULT,
      ),
    ).toMatchObject({ minScore: null, minDurationSeconds: null });
  });

  it('falls back to the platform default when the item sets no duration', () => {
    expect(
      resolveRoleplayGate(
        { completionLogic: TrackItemCompletionLogic.DURATION },
        DEFAULT,
      ).minDurationSeconds,
    ).toBe(DEFAULT);
    // An untouched legacy item: both gates, platform duration.
    expect(resolveRoleplayGate({}, DEFAULT)).toEqual({
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: null,
      minDurationSeconds: DEFAULT,
    });
  });

  it('treats an explicit 0 as "no minimum duration", not as unset', () => {
    expect(
      resolveRoleplayGate(
        {
          completionLogic: TrackItemCompletionLogic.DURATION,
          minDurationSeconds: 0,
        },
        DEFAULT,
      ).minDurationSeconds,
    ).toBeNull();
  });

  it('treats a 0 minimum score as no score gate', () => {
    expect(
      resolveRoleplayGate(
        { completionLogic: TrackItemCompletionLogic.SCORE, minScore: 0 },
        DEFAULT,
      ).minScore,
    ).toBeNull();
  });
});

describe('roleplayFailureReasons', () => {
  const both = resolveRoleplayGate(
    {
      completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
      minScore: 60,
      minDurationSeconds: 90,
    },
    DEFAULT,
  );

  it('is empty when every gate is cleared', () => {
    expect(
      roleplayFailureReasons(both, { score: 70, durationSeconds: 95 }),
    ).toEqual([]);
  });

  it('names the duration gate alone', () => {
    expect(
      roleplayFailureReasons(both, { score: 70, durationSeconds: 30 }),
    ).toEqual([INSUFFICIENT_DURATION]);
  });

  it('names the score gate alone', () => {
    expect(
      roleplayFailureReasons(both, { score: 10, durationSeconds: 95 }),
    ).toEqual([INSUFFICIENT_SCORE]);
  });

  it('names both when both are missed', () => {
    expect(
      roleplayFailureReasons(both, { score: 10, durationSeconds: 30 }),
    ).toEqual([INSUFFICIENT_DURATION, INSUFFICIENT_SCORE]);
  });

  it('treats a missing score as 0 against a real score gate', () => {
    expect(
      roleplayFailureReasons(both, { score: undefined, durationSeconds: 95 }),
    ).toEqual([INSUFFICIENT_SCORE]);
  });

  it('never fails a PARTICIPATION item', () => {
    const gate = resolveRoleplayGate(
      { completionLogic: TrackItemCompletionLogic.PARTICIPATION },
      DEFAULT,
    );
    expect(
      roleplayFailureReasons(gate, { score: -50, durationSeconds: 1 }),
    ).toEqual([]);
  });

  it('ignores duration under SCORE and score under DURATION', () => {
    const scoreOnly = resolveRoleplayGate(
      { completionLogic: TrackItemCompletionLogic.SCORE, minScore: 60 },
      DEFAULT,
    );
    expect(
      roleplayFailureReasons(scoreOnly, { score: 70, durationSeconds: 5 }),
    ).toEqual([]);
    const durationOnly = resolveRoleplayGate(
      {
        completionLogic: TrackItemCompletionLogic.DURATION,
        minScore: 60,
        minDurationSeconds: 90,
      },
      DEFAULT,
    );
    expect(
      roleplayFailureReasons(durationOnly, { score: -20, durationSeconds: 91 }),
    ).toEqual([]);
  });
});
