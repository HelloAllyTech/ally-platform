import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import { PmAgentSettingsService } from '../service/pm-agent-settings.service';
import { PmAgentStateService } from '../service/pm-agent-state.service';
import { UpdatePmAgentSettingsDto } from '../dto/pm-agent.dto';
import { validateCardPayload } from '../dto/pm-card-payload.dto';
import {
  PmAgentState,
  PmCardCategory,
  PmCardKind,
  PmCardStatus,
} from '../enum/pm-agent.enum';
import { istMonthStart, nextRunAt } from '../util/ist.util';
import { questionPayload, recommendationPayload } from './pm-agent.fakes';

describe('PmAgentSettingsService.validate', () => {
  const dtoErrors = (body: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdatePmAgentSettingsDto, body));

  it.each([
    [{ queueCap: 0 }],
    [{ queueCap: 11 }],
    [{ queueCap: 2.5 }],
    [{ runHourIst: -1 }],
    [{ runHourIst: 24 }],
    [{ monthlyBudgetUsd: -0.01 }],
    [{ categoryWeights: { not_a_category: 1 } }],
    [{ categoryWeights: { ui_ux: 11 } }],
    [{ autoBuildPaused: true }],
  ])('refuses %j', (body) => {
    expect(() =>
      PmAgentSettingsService.validate(body as UpdatePmAgentSettingsDto),
    ).toThrow(BadRequestException);
  });

  it('the DTO rejects the same bounds before the service sees them', () => {
    expect(dtoErrors({ queueCap: 0 })).not.toHaveLength(0);
    expect(dtoErrors({ queueCap: 11 })).not.toHaveLength(0);
    expect(dtoErrors({ runHourIst: 24 })).not.toHaveLength(0);
    expect(dtoErrors({ monthlyBudgetUsd: -1 })).not.toHaveLength(0);
    expect(
      dtoErrors({ queueCap: 10, runHourIst: 0, monthlyBudgetUsd: 0 }),
    ).toHaveLength(0);
  });

  it('accepts the edges and normalises the budget', () => {
    expect(
      PmAgentSettingsService.validate({
        queueCap: 1,
        runHourIst: 23,
        monthlyBudgetUsd: 0,
        categoryWeights: { [PmCardCategory.COST]: 0 },
      }),
    ).toEqual({
      queueCap: 1,
      runHourIst: 23,
      monthlyBudgetUsd: '0.00',
      categoryWeights: { cost: 0 },
    });
  });

  it('autoBuildPaused=false resumes and resets the failure counter', () => {
    expect(PmAgentSettingsService.validate({ autoBuildPaused: false })).toEqual(
      {
        autoBuildPaused: false,
        autoBuildPausedReason: null,
        autoBuildPausedAt: null,
        consecutiveBuildFailures: 0,
      },
    );
  });
});

describe('PmAgentStateService.deriveState', () => {
  const base = {
    settings: {
      enabled: true,
      pauseAutoBuild: false,
      autoBuildPaused: false,
      queueCap: 5,
    },
    running: false,
    openCards: 2,
    spentUsd: 10,
    reservedUsd: 0,
    monthlyBudgetUsd: 100,
  };

  it.each([
    ['idle', {}, PmAgentState.IDLE],
    [
      'disabled beats everything',
      { settings: { ...base.settings, enabled: false }, running: true },
      PmAgentState.DISABLED,
    ],
    ['running', { running: true, openCards: 5 }, PmAgentState.RUNNING],
    [
      'budget exhausted (incl. reservations)',
      { spentUsd: 90, reservedUsd: 10 },
      PmAgentState.BUDGET_EXHAUSTED,
    ],
    ['queue full', { openCards: 5 }, PmAgentState.QUEUE_FULL],
    [
      'paused',
      { settings: { ...base.settings, autoBuildPaused: true } },
      PmAgentState.PAUSED,
    ],
  ])('%s', (_label, over, expected) => {
    expect(PmAgentStateService.deriveState({ ...base, ...over } as never)).toBe(
      expected,
    );
  });
});

describe('IST time helpers', () => {
  it('the budget month starts at 00:00 IST on the 1st', () => {
    // 2026-12-01 03:00 IST is still 2026-11-30 21:30 UTC.
    expect(istMonthStart(new Date('2026-11-30T21:30:00Z')).toISOString()).toBe(
      '2026-11-30T18:30:00.000Z',
    );
    expect(istMonthStart(new Date('2026-11-30T18:00:00Z')).toISOString()).toBe(
      '2026-10-31T18:30:00.000Z',
    );
  });

  it('the next run is the next runHour:00 IST', () => {
    // 08:00 IST → 09:00 IST the same day.
    expect(nextRunAt(9, new Date('2026-11-17T02:30:00Z')).toISOString()).toBe(
      '2026-11-17T03:30:00.000Z',
    );
    // 10:00 IST → tomorrow 09:00 IST.
    expect(nextRunAt(9, new Date('2026-11-17T04:30:00Z')).toISOString()).toBe(
      '2026-11-18T03:30:00.000Z',
    );
  });
});

describe('validateCardPayload', () => {
  it('accepts the sample cards', () => {
    expect(
      validateCardPayload(PmCardKind.RECOMMENDATION, recommendationPayload()),
    ).toEqual([]);
    expect(validateCardPayload(PmCardKind.QUESTION, questionPayload())).toEqual(
      [],
    );
  });

  it.each([
    [
      'a 13-word title',
      {
        title:
          'one two three four five six seven eight nine ten eleven twelve thirteen',
      },
      'title',
    ],
    [
      'a why without a number',
      { whyHeadline: 'Learners do not return' },
      'whyHeadline',
    ],
    ['four change bullets', { change: ['a', 'b', 'c', 'd'] }, 'change'],
    [
      'a 16-word change bullet',
      {
        change: [
          'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
        ],
      },
      'change',
    ],
    ['size L', { size: 'L' }, 'size'],
    ['ally-mobile (no release pipeline)', { repos: ['ally-mobile'] }, 'repos'],
    ['no evidence', { evidenceIds: [] }, 'evidenceIds'],
    ['an unknown field', { secretPlan: 'x' }, 'secretPlan'],
  ])('rejects %s', (_label, over, field) => {
    const problems = validateCardPayload(
      PmCardKind.RECOMMENDATION,
      recommendationPayload(over),
    );
    expect(problems.join('\n')).toContain(field);
  });

  it('rejects a question with one option or a 9-word option', () => {
    expect(
      validateCardPayload(
        PmCardKind.QUESTION,
        questionPayload({ options: [{ label: 'Only', consequence: 'x' }] }),
      ),
    ).not.toEqual([]);
    expect(
      validateCardPayload(
        PmCardKind.QUESTION,
        questionPayload({
          options: [
            {
              label: 'one two three four five six seven eight nine',
              consequence: 'x',
            },
            { label: 'b', consequence: 'y' },
          ],
        }),
      ),
    ).not.toEqual([]);
  });
});

describe('migration 1982000000000 CHECK constraints', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../../database/migrations/1982000000000-CreatePmAgent.ts',
    ),
    'utf8',
  );

  it.each([
    ['PmCardStatus', Object.values(PmCardStatus)],
    ['PmCardCategory', Object.values(PmCardCategory)],
  ])('lists every %s value', (_name, values) => {
    for (const value of values) {
      expect(sql).toContain(`'${value}'`);
    }
  });
});
