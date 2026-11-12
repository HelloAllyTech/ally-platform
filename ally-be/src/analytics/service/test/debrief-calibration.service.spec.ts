import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DebriefCalibrationService } from '../debrief-calibration.service';
import { DebriefQualityRepository } from '../../repository/debrief-quality.repository';

const SESSION = '0445f545-53c1-43c5-89f1-fb04ea2317be';

const scores = {
  evidence_specificity: 7,
  accuracy: 8,
  actionability: 6,
  prioritisation: 7,
  personalisation_progress: 5,
  practice_alignment: 6,
  tone: 8,
  clarity: 8,
};

describe('DebriefCalibrationService', () => {
  let query: jest.Mock;
  let buildTranscript: jest.Mock;
  let service: DebriefCalibrationService;

  const judged = {
    counselor_id: 1,
    debrief_text: 'You said (turn 2) — email me at a@b.com',
    language: 'en',
    tenant_id: 't1',
  };

  beforeEach(() => {
    query = jest.fn();
    buildTranscript = jest.fn().mockResolvedValue({
      turns: [
        { role: 'client', text: 'I feel stuck', turn_index: 1 },
        { role: 'counselor', text: 'Call me on 9876543210', turn_index: 2 },
      ],
      turnByMessageId: new Map(),
    });
    service = new DebriefCalibrationService(
      { query } as unknown as DataSource,
      { buildTranscript } as unknown as DebriefQualityRepository,
    );
  });

  it('refuses a debrief the judge has not scored', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.getItem(481, SESSION)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses a debrief of the rater's own practice", async () => {
    query.mockResolvedValueOnce([judged]);
    await expect(service.getItem(1, SESSION)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('shows a redacted transcript and debrief in the judge numbering', async () => {
    query.mockResolvedValueOnce([judged]).mockResolvedValueOnce([]);
    const item = await service.getItem(481, SESSION);
    expect(item.transcript).toEqual([
      { turnIndex: 1, speaker: 'client', text: 'I feel stuck' },
      {
        turnIndex: 2,
        speaker: 'learner',
        text: expect.not.stringContaining('9876543210'),
      },
    ]);
    expect(item.debrief).not.toContain('a@b.com');
    expect(item.myRating).toBeNull();
  });

  it("rates the Debrief agent's debrief as the current judge read it", async () => {
    query
      .mockResolvedValueOnce([
        {
          counselor_id: 1,
          cards: {
            opening: 'You stayed with her — email me at a@b.com',
            what_worked: [],
            work_on_this: [],
            skill_words: [],
            reflective_question: 'What helped?',
          },
          language: 'hi',
          tenant_id: 't1',
        },
      ])
      .mockResolvedValueOnce([]);
    const item = await service.getItem(481, SESSION);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('debrief_runs');
    expect(sql).toContain(`workspace->'judge'`);
    expect(sql).not.toContain('debrief_quality_judgment');
    expect(item.debrief).toContain('You stayed with her');
    expect(item.debrief).not.toContain('a@b.com');
    expect(item.language).toBe('hi');
  });

  it("compares hand scores with the current judge's, dimension by dimension", async () => {
    const dims = [
      ['evidence_specificity', 'evidenceSpecificity'],
      ['accuracy', 'accuracy'],
      ['actionability', 'actionability'],
      ['prioritisation', 'prioritisation'],
      ['personalisation_progress', 'personalisationProgress'],
      ['practice_alignment', 'practiceAlignment'],
      ['tone', 'tone'],
      ['clarity', 'clarity'],
    ];
    // 20 rated debriefs: the person agrees with the judge on every dimension
    // except accuracy, where they score two points lower.
    const rated = Array.from({ length: 20 }, (_, i) => {
      const score = 2 + (i % 8);
      const row: Record<string, unknown> = {
        id: `s${i}`,
        h_fails: i === 0 ? ['missed_risk_cue'] : [],
        judge: {
          model: 'gemini-2.5-pro',
          promptVersion: 'v1+g1',
          dimensions: dims.map(([d]) => ({ dimension: d, score })),
          hardFails: i === 0 ? [{ code: 'missed_risk_cue', evidence: 'x' }] : [],
        },
      };
      for (const [d, col] of dims) {
        row[`h_${col}`] = d === 'accuracy' ? score - 2 : score;
      }
      return row;
    });
    query
      .mockResolvedValueOnce(rated)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ debriefs: 20, ratings: 20, raters: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ debriefs: 0, verdicts: 0, reviewers: 0 }]);
    const a = await service.getAgreement();
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('debrief_runs');
    expect(sql).not.toContain('debrief_quality_judgment');
    expect(a.judge).toEqual({
      judgeModel: 'gemini-2.5-pro',
      judgePromptVersion: 'v1+g1',
    });
    expect(a.judgeVsHuman.dimensions.tone).toMatchObject({
      pairs: 20,
      debriefs: 20,
      weightedKappa: 1,
      withinOnePct: 100,
    });
    expect(a.judgeVsHuman.dimensions.accuracy).toMatchObject({
      pairs: 20,
      withinOnePct: 0,
      meanDifference: 2,
    });
    expect(a.judgeVsHuman.hardFails.missed_risk_cue).toMatchObject({
      pairs: 20,
    });
  });

  it('rejects an invalid rating before touching the database', async () => {
    await expect(
      service.submit(481, SESSION, { scores: { tone: 11 }, hardFails: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('upserts in rubric order and de-duplicates hard fails', async () => {
    query
      .mockResolvedValueOnce([judged])
      .mockResolvedValueOnce([{ created: true }]);
    const saved = await service.submit(481, SESSION, {
      scores,
      hardFails: ['missed_risk_cue', 'missed_risk_cue'],
      note: '  ',
    });
    expect(saved).toEqual({ created: true });
    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain(
      'ON CONFLICT ("scenarioSessionId", "raterId", "rubricVersion")',
    );
    expect(values.slice(0, 4)).toEqual(['t1', SESSION, 481, 'v1']);
    expect(values.slice(-2)).toEqual(['["missed_risk_cue"]', null]);
  });
});
