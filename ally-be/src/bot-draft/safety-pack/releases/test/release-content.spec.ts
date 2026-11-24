import { SafetyPackId } from '../../../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../../safety-packs';
import {
  applyEdit,
  contentHash,
  diffPacks,
  noticeText,
  releaseBlockers,
  ReleaseContentError,
  supportedLanguages,
  type ReleaseTestResults,
} from '../release-content';

const code = SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH];
const draft = {
  ...code,
  version: code.version + 1,
  rules: [...code.rules, 'One more rule.'],
};
const LANGS = ['en', 'hi'];

const results = (
  over: Partial<ReleaseTestResults> = {},
): ReleaseTestResults => ({
  state: 'done',
  chatbotId: 'b',
  contentHash: contentHash(draft),
  suiteVersion: 'v1',
  startedAt: 'x',
  startedBy: 1,
  allPassed: true,
  languages: LANGS.map((language) => ({
    language,
    status: 'pass',
    passed: 4,
    total: 4,
    failedCases: [],
  })),
  ...over,
});

describe('the release gate (stage 9)', () => {
  it('lets a draft out only when every supported language passed on this content', () => {
    expect(
      releaseBlockers(
        { status: 'testing', testResults: results() },
        draft,
        LANGS,
        'v1',
      ),
    ).toEqual([]);
  });

  it('refuses a failing language, with no override', () => {
    const failing = results({
      allPassed: false,
      languages: [
        {
          language: 'en',
          status: 'pass',
          passed: 4,
          total: 4,
          failedCases: [],
        },
        {
          language: 'hi',
          status: 'fail',
          passed: 3,
          total: 4,
          failedCases: ['hi-1'],
        },
      ],
    });
    expect(
      releaseBlockers(
        { status: 'testing', testResults: failing },
        draft,
        LANGS,
        'v1',
      ),
    ).toEqual(['language_failed:hi']);
  });

  it('refuses an untested, running, errored, edited, outdated or partial run', () => {
    const gate = (
      testResults: ReleaseTestResults | null,
      pack = draft,
      v = 'v1',
    ) => releaseBlockers({ status: 'testing', testResults }, pack, LANGS, v);
    expect(gate(null)).toEqual(['not_tested']);
    expect(gate(results({ state: 'running' }))).toEqual(['suite_running']);
    expect(gate(results({ state: 'error' }))).toEqual(['suite_error']);
    expect(gate(results(), { ...draft, rules: ['changed'] })).toContain(
      'content_changed',
    );
    expect(gate(results(), draft, 'v2')).toContain('suite_outdated');
    expect(gate(results({ languages: [results().languages[0]] }))).toEqual([
      'language_missing:hi',
    ]);
    expect(
      releaseBlockers(
        { status: 'released', testResults: results() },
        draft,
        LANGS,
        'v1',
      ),
    ).toEqual(['already_released']);
  });

  it('knows the suite languages', () => {
    expect(supportedLanguages()).toContain('en');
  });
});

describe('what a curator may change', () => {
  it('cannot weaken the pack: classifier floor, disclaimer, empty rules, id and strength', () => {
    const fails = (change: object) => {
      try {
        applyEdit(code, code, change as never);
        return null;
      } catch (error) {
        return (error as ReleaseContentError).code;
      }
    };
    expect(
      fails({ requiredSettings: { crisisClassifierEnabled: false } }),
    ).toBe('classifier_floor');
    expect(fails({ disclaimer: '' })).toBe('disclaimer_required');
    expect(fails({ rules: ['  '] })).toBe('rules_required');
    expect(fails({ name: '' })).toBe('name_required');
    const next = applyEdit(code, code, {
      rules: [' Trimmed. ', ''],
      id: 'other',
      strength: 0,
    } as never);
    expect(next.rules).toEqual(['Trimmed.']);
    expect(next.id).toBe(code.id);
    expect(next.strength).toBe(code.strength);
  });
});

describe('the diff and the owner notice', () => {
  it('lists added and removed lines and sends no curator note', () => {
    const after = { ...draft, never: [...code.never, 'Never X.'] };
    const diff = diffPacks(code, after);
    expect(diff.changed).toBe(true);
    expect(diff.lists.rules.added).toEqual(['One more rule.']);
    expect(diff.lists.never.added).toEqual(['Never X.']);
    expect(diffPacks(code, code).changed).toBe(false);
    const notice = noticeText({
      kind: 'release',
      packName: code.name,
      version: 3,
      chatbotNames: ['A', 'B', 'C', 'D', 'E', 'F'],
      diff,
    });
    expect(notice.body).toContain('1 added, 0 removed');
    expect(notice.body).toContain('Added: Never X.');
    expect(notice.body).toContain('and 1 more');
    const rollback = noticeText({
      kind: 'rollback',
      packName: code.name,
      version: 2,
      chatbotNames: ['A'],
      diff: diffPacks(after, code),
    });
    expect(rollback.subject).toContain('restored');
  });
});
