import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  clinicalListProblem,
  clinicalPattern,
  clinicalPatternsFor,
  defaultClinicalLists,
  mergeClinicalLists,
} from '../constants/debrief-clinical-lists.constants';
import { DebriefClinicalListsService } from '../service/debrief-clinical-lists.service';
import {
  DebriefCheckCode,
  replyCheckFailures,
} from '../util/debrief-cards.util';
import {
  DEBRIEF_ACTIONS,
  debriefCan,
} from '../util/debrief-console-roles.util';

/**
 * Settings › Clinical lists (2026-11-16): the words behind the score,
 * diagnosis and jargon checks, editable per language by the clinical advisor
 * and the owner.
 */
describe('clinical lists', () => {
  describe('the defaults match what the checks matched before', () => {
    const en = clinicalPatternsFor(defaultClinicalLists(), 'en');

    it.each([
      'You are anxious about this.',
      'you might be depressed',
      'You suffer from anxiety.',
      'That is an attachment style.',
      'You seem traumatized.',
    ])('diagnosis: "%s"', (t) => {
      expect(en.diagnosis!.test(t)).toBe(true);
    });

    it.each([
      'This is transference.',
      'Counter-transference came up.',
      'psycho-educational material',
      'Use psychoeducation here.',
      'two ego-states',
      'cognitive distortions',
      'catastrophizing',
    ])('jargon: "%s"', (t) => {
      expect(en.jargon!.test(t)).toBe(true);
    });

    it.each(['Your score went up.', 'You scored well.', 'a rating of'])(
      'score words: "%s"',
      (t) => {
        expect(en.score!.test(t)).toBe(true);
      },
    );

    it.each([
      'You noticed she was anxious.',
      'The client talked about her anxiety.',
      'They kept the scoreboard.',
      'Explain it in plain words.',
    ])('leaves alone: "%s"', (t) => {
      expect(
        en.diagnosis!.test(t) || en.jargon!.test(t) || en.score!.test(t),
      ).toBe(false);
    });

    it('keeps numeric scores in code', () => {
      expect(replyCheckFailures('That was a 7/10 reply.', [])).toContain(
        DebriefCheckCode.SCORE_MENTIONED,
      );
    });

    it('starts the other languages empty', () => {
      const d = defaultClinicalLists();
      for (const kind of ['jargon', 'diagnosis', 'score'] as const) {
        expect(d[kind].hi).toEqual([]);
        expect(d[kind].ml).toEqual([]);
      }
    });
  });

  describe('entries are words, never patterns', () => {
    it('matches an entry literally, at word boundaries, in any script', () => {
      const p = clinicalPattern(['a.*b', 'मनोशिक्षा'])!;
      expect(p.test('see a.*b here')).toBe(true);
      expect(p.test('axxb')).toBe(false);
      expect(p.test('यह मनोशिक्षा है')).toBe(true);
      expect(p.test('मनोशिक्षाएँ')).toBe(false);
    });

    it('refuses an unknown list, language or a bad entry', () => {
      expect(clinicalListProblem('jargon', 'en', ['ok'])).toBeNull();
      expect(clinicalListProblem('nope', 'en', [])).toMatch(/not a clinical/);
      expect(clinicalListProblem('jargon', 'fr', [])).toMatch(/not a language/);
      expect(clinicalListProblem('jargon', 'en', [''])).toMatch(
        /word or phrase/,
      );
      expect(clinicalListProblem('jargon', 'en', ['x'.repeat(81)])).toMatch(
        /at most 80/,
      );
    });

    it('reads a stored list that no longer validates as its default', () => {
      const merged = mergeClinicalLists({ jargon: { en: 'not a list' } });
      expect(merged.jargon.en).toEqual(defaultClinicalLists().jargon.en);
    });
  });

  describe('an edit takes effect', () => {
    function build() {
      let row: any = null;
      const rows = {
        findOne: jest.fn(async () => row),
        create: jest.fn((v: any) => v),
        save: jest.fn(async (v: any) => (row = { ...v })),
      };
      const audit = { log: jest.fn(async () => undefined) };
      const svc = new DebriefClinicalListsService(rows as any, audit as any);
      return { svc, audit };
    }

    it('replaces one language list, audits before and after, and the checks read it', async () => {
      const { svc, audit } = build();
      expect((await svc.patterns('hi')).jargon!.test('मनोशिक्षा')).toBe(false);
      await svc.update('jargon', 'hi', ['मनोशिक्षा', ' मनोशिक्षा '], 7);
      const hi = await svc.patterns('hi');
      expect(hi.jargon!.test('यह मनोशिक्षा है')).toBe(true);
      // English stays in force for every language.
      expect(hi.jargon!.test('transference')).toBe(true);
      // Another language does not get Hindi's list.
      expect((await svc.patterns('ta')).jargon!.test('मनोशिक्षा')).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'DEBRIEF_SETTINGS_CHANGED',
          userId: 7,
          details: expect.objectContaining({
            clinicalList: {
              kind: 'jargon',
              language: 'hi',
              before: [],
              after: ['मनोशिक्षा'],
            },
          }),
        }),
      );
      // null restores the default.
      await svc.update('jargon', 'hi', null, 7);
      expect((await svc.patterns('hi')).jargon!.test('मनोशिक्षा')).toBe(false);
    });

    it('an emptied English list stops that check', async () => {
      const { svc } = build();
      await svc.update('score', 'en', [], 9);
      const en = await svc.patterns('en');
      expect(en.score).toBeNull();
      expect(replyCheckFailures('You scored well.', [], en)).toEqual([]);
      expect(replyCheckFailures('70% of it.', [], en)).toContain(
        DebriefCheckCode.SCORE_MENTIONED,
      );
    });

    it('refuses a bad list and writes nothing', async () => {
      const { svc, audit } = build();
      await expect(svc.update('jargon', 'en', [''], 7)).rejects.toThrow();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('falls back to the defaults when the row cannot be read', async () => {
      const svc = new DebriefClinicalListsService(
        {
          findOne: jest.fn(async () => Promise.reject(new Error('db'))),
        } as any,
        { log: jest.fn() } as any,
      );
      expect((await svc.patterns('en')).jargon!.test('transference')).toBe(
        true,
      );
    });
  });

  describe('who may edit', () => {
    it('the clinical advisor and the owner, not the Ally team alone', () => {
      expect(DEBRIEF_ACTIONS.clinicalLists).toEqual([
        PERMISSIONS.REVIEW_DEBRIEFS,
        PERMISSIONS.MANAGE_DEBRIEF_SETTINGS,
      ]);
      expect(debriefCan([PERMISSIONS.SYSTEM_ACCESS]).clinicalLists).toBe(false);
      expect(debriefCan([PERMISSIONS.REVIEW_DEBRIEFS]).clinicalLists).toBe(
        true,
      );
      expect(
        debriefCan([PERMISSIONS.MANAGE_DEBRIEF_SETTINGS]).clinicalLists,
      ).toBe(true);
    });
  });
});
