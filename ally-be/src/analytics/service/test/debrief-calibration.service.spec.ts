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
