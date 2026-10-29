import {
  DebriefQualityJudgeService,
  toDebriefQualityStats,
} from '../debrief-quality-judge.service';

describe('toDebriefQualityStats', () => {
  it('withholds every rate below 20 scored debriefs', () => {
    const s = toDebriefQualityStats({
      key: 'kn',
      n: 6,
      p25: 6,
      p50: 7,
      p75: 8,
      passed: 5,
      hard_failed: 0,
    });
    expect(s).toEqual({
      n: 6,
      belowReportingFloor: true,
      p25: null,
      p50: null,
      p75: null,
      passRate: null,
      hardFailRate: null,
    });
  });

  it('reports rates at and above the floor', () => {
    const s = toDebriefQualityStats({
      key: 'all',
      n: 40,
      p25: 6.25,
      p50: 7.1,
      p75: 8.333,
      passed: 10,
      hard_failed: 4,
    });
    expect(s).toEqual({
      n: 40,
      belowReportingFloor: false,
      p25: 6.25,
      p50: 7.1,
      p75: 8.33,
      passRate: 0.25,
      hardFailRate: 0.1,
    });
  });

  it('treats no rows as zero, below the floor', () => {
    expect(toDebriefQualityStats(undefined)).toMatchObject({
      n: 0,
      belowReportingFloor: true,
      p50: null,
    });
  });
});

describe('DebriefQualityJudgeService.getSummary', () => {
  it('reads one judge pair and cuts every baseline slice', async () => {
    const agg = {
      key: 'all',
      n: 30,
      p25: 6,
      p50: 7,
      p75: 8,
      passed: 9,
      hard_failed: 3,
    };
    const repo = {
      aggregate: jest.fn(async (_p, _d, slice?: string) =>
        slice ? [{ ...agg, key: `${slice}-a` }] : [agg],
      ),
      dimensionMeans: jest.fn().mockResolvedValue([]),
      hardFailCounts: jest
        .fn()
        .mockResolvedValue([{ code: 'missed_risk_cue', n: 3 }]),
      judgeVersions: jest.fn().mockResolvedValue([]),
      selectSessions: jest.fn().mockResolvedValue([{ id: 'x' }, { id: 'y' }]),
    };
    const service = new DebriefQualityJudgeService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const out = await service.getSummary({ sinceDays: 30 });

    const pair = { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' };
    expect(repo.aggregate).toHaveBeenCalledWith(pair, 30);
    for (const s of [
      'language',
      'workerType',
      'sessionLength',
      'debriefSource',
    ]) {
      expect(repo.aggregate).toHaveBeenCalledWith(pair, 30, s);
    }
    expect(repo.selectSessions).toHaveBeenCalledWith({
      sinceDays: 30,
      unjudgedForVersion: pair,
    });
    expect(out.unscored).toBe(2);
    expect(out.overall.passRate).toBe(0.3);
    expect(out.slices.language[0].key).toBe('language-a');
    expect(out.hardFails).toEqual([{ code: 'missed_risk_cue', n: 3 }]);
  });
});
