import { alwaysAsk, confidenceOf } from '../util/debrief-always-ask.util';
import {
  defaultOwnerSettings,
  ownerSettingProblem,
} from '../constants/debrief-owner-settings.constants';
import { lastChangesOf } from '../service/debrief-settings.service';

const on = { askLowConfidence: true, askModels: false };

describe('"Always asks a person" (v2 A1)', () => {
  it('locked on: the Safety reader, crisis and support copy, pinned rules, budget increases', () => {
    expect(
      alwaysAsk(
        {
          change: {
            ideaKind: 'prompt_edit',
            promptCode: 'debrief_safety_reader_system',
          },
        },
        on,
      ),
    ).toMatchObject({ kind: 'safety_reader', locked: true });
    expect(
      alwaysAsk(
        {
          change: { ideaKind: 'release' },
          evidence: { diff: { prompts: [{ code: 'debrief_quality_rubric' }] } },
        },
        on,
      ),
    ).toMatchObject({ kind: 'pinned_rule', locked: true });
    expect(
      alwaysAsk(
        {
          change: {
            ideaKind: 'pinned_rule',
            promptCode: 'debrief_quality_judge_system',
          },
        },
        on,
      )?.kind,
    ).toBe('pinned_rule');
    expect(
      alwaysAsk(
        { change: { ideaKind: 'release', touches: 'crisis_lines' } },
        on,
      )?.kind,
    ).toBe('crisis_support');
    expect(
      alwaysAsk(
        {
          change: { ideaKind: 'release' },
          evidence: {
            diff: {
              settings: [{ key: 'monthlyCapUsd', before: 50, after: 80 }],
            },
          },
        },
        { askLowConfidence: false, askModels: false },
      ),
    ).toMatchObject({ kind: 'budget_increase', locked: true });
    // A budget cut is not an increase.
    expect(
      alwaysAsk(
        {
          change: { ideaKind: 'release' },
          evidence: {
            diff: {
              settings: [{ key: 'sessionBudgetUsd', before: 1, after: 0.8 }],
            },
          },
        },
        on,
      ),
    ).toBeNull();
  });

  it('low confidence waits while askLowConfidence is on; missing confidence reads as high', () => {
    const low = {
      change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
      evidence: { confidence: { level: 'low', why: 'only 4 comments' } },
    };
    expect(alwaysAsk(low, on)).toEqual({
      kind: 'low_confidence',
      locked: false,
      waitsBecause:
        'The Debrief PM agent is not sure about it: only 4 comments',
    });
    expect(alwaysAsk(low, { ...on, askLowConfidence: false })).toBeNull();
    expect(alwaysAsk({ ...low, evidence: {} }, on)).toBeNull();
    expect(confidenceOf({ confidence: 'low' })).toEqual({
      level: 'low',
      why: null,
    });
    expect(confidenceOf({})).toBeNull();
  });

  it('new models wait only while askModels is on; a model the live release runs is not new', () => {
    const idea = {
      change: { ideaKind: 'release' },
      evidence: {
        diff: {
          steps: [
            {
              step: 'writer',
              field: 'model',
              before: 'gpt-4.1',
              after: 'gemini-3-pro',
            },
          ],
        },
      },
    };
    expect(alwaysAsk(idea, on)).toBeNull();
    expect(alwaysAsk(idea, { ...on, askModels: true })).toMatchObject({
      kind: 'new_model',
      waitsBecause: 'It brings in a new model: gemini-3-pro.',
    });
    expect(
      alwaysAsk(idea, { ...on, askModels: true }, new Set(['gemini-3-pro'])),
    ).toBeNull();
  });

  it('every other change runs on its own', () => {
    expect(
      alwaysAsk(
        {
          change: {
            ideaKind: 'prompt_edit',
            promptCode: 'debrief_writer_system',
          },
        },
        on,
      ),
    ).toBeNull();
    expect(
      alwaysAsk(
        {
          change: {
            ideaKind: 'setting',
            settingKey: 'maxRevisionRounds',
            settingValue: '2',
          },
        },
        on,
      ),
    ).toBeNull();
  });
});

describe('v2 owner settings (A1, A4, K1, S1)', () => {
  it('has the new keys with their defaults', () => {
    expect(defaultOwnerSettings()).toMatchObject({
      scoreWeightQuality: 0.4,
      scoreWeightPass: 0.25,
      scoreWeightHelpful: 0.2,
      scoreWeightFlags: 0.15,
      undoMargin: 0.3,
      watchDays: 14,
      canaryShare: 0.1,
      canaryMinRuns: 40,
      canaryMinDays: 3,
      askLowConfidence: true,
      askModels: false,
      slackChannel: '',
      safetyContact: '',
    });
  });

  it('text settings take one line of text', () => {
    expect(ownerSettingProblem('slackChannel', '#debrief-alerts')).toBeNull();
    expect(ownerSettingProblem('safetyContact', '<@U0123ABC>')).toBeNull();
    expect(ownerSettingProblem('slackChannel', '')).toBeNull();
    expect(ownerSettingProblem('slackChannel', 5)).toBe(
      'slackChannel must be text',
    );
    expect(ownerSettingProblem('slackChannel', 'a\nb')).toBe(
      'slackChannel must be one line',
    );
    expect(ownerSettingProblem('slackChannel', 'x'.repeat(81))).toMatch(
      /at most 80/,
    );
    expect(ownerSettingProblem('undoMargin', 0.01)).toMatch(/at least/);
  });

  it('Settings › Tests shows who last changed a value, when, why and the change', () => {
    expect(
      lastChangesOf({
        gateCases: {
          by: 'Debrief PM agent',
          byId: null,
          at: '2026-11-16T00:00:00Z',
          why: 'Volume doubled',
          changeId: 'c1',
        },
        notASetting: { at: 'x' },
        quickTestCases: { byId: 7, at: '2026-11-15T00:00:00Z' },
      }),
    ).toEqual({
      gateCases: {
        lastChangedBy: 'Debrief PM agent',
        lastChangedById: null,
        lastChangedAt: '2026-11-16T00:00:00Z',
        why: 'Volume doubled',
        changeId: 'c1',
      },
      quickTestCases: {
        lastChangedBy: 'A person',
        lastChangedById: 7,
        lastChangedAt: '2026-11-15T00:00:00Z',
        why: null,
        changeId: null,
      },
    });
  });
});
