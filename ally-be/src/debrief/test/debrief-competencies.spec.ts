import {
  buildExpectations,
  customCodesIn,
  readableCards,
  withoutCustomCodes,
} from '../util/debrief-competencies.util';
import {
  DebriefCards,
  DebriefCheckCode,
  publishableCards,
  renderCards,
  runDebriefChecks,
} from '../util/debrief-cards.util';
import { DebriefContextRepository } from '../service/debrief-context.repository';
import { sectionText } from '../service/debrief-feedback.service';

/**
 * Review 2026-11-16: the Debrief agent reads what a roleplay expects (its
 * behaviours), not only competency names, and a custom competency's code
 * (`478_custom_27`) never reaches a learner.
 */
describe('what a roleplay expects', () => {
  it("lists the roleplay's own behaviours first, adds custom competencies' behaviours without duplicates, and keeps named competencies as labels", () => {
    const out = buildExpectations(
      [
        // A named competency with behaviours.
        {
          id: 'c1',
          name: 'Empathy',
          is_custom: false,
          behaviour: 'Reflects feelings',
          type: 'HELPFUL',
        },
        // A named competency with none (48 of 79 in prod).
        {
          id: 'c2',
          name: 'QPR',
          is_custom: false,
          behaviour: null,
          type: null,
        },
        // A custom competency: its code never travels.
        {
          id: 'c3',
          name: '478_custom_27',
          is_custom: true,
          behaviour: 'Asks open questions',
          type: 'HELPFUL',
        },
        {
          id: 'c3',
          name: '478_custom_27',
          is_custom: true,
          behaviour: 'Interrupts the client',
          type: 'UNHELPFUL',
        },
        // A code-named row not marked custom is still a code.
        {
          id: 'c4',
          name: '12_custom_3',
          is_custom: false,
          behaviour: 'Summarises',
          type: 'HELPFUL',
        },
      ],
      [
        { category: 'SHOULD_DO', behaviour: 'Asks open questions' },
        { category: 'SHOULD_NOT_DO', behaviour: 'Gives advice too early' },
      ],
    );
    expect(out.helpful).toEqual(['Asks open questions', 'Summarises']);
    expect(out.unhelpful).toEqual([
      'Gives advice too early',
      'Interrupts the client',
    ]);
    expect(out.competencies).toEqual([
      { name: 'Empathy', helpful: ['Reflects feelings'], unhelpful: [] },
      { name: 'QPR', helpful: [], unhelpful: [] },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/_custom_/);
  });

  it('lists each behaviour once: one a named competency lists sits under it, not again in the roleplay lists', () => {
    const out = buildExpectations(
      [
        {
          id: 'c1',
          name: 'Psychoeducation',
          is_custom: false,
          behaviour: 'Asks open questions',
          type: 'HELPFUL',
        },
        {
          id: 'c1',
          name: 'Psychoeducation',
          is_custom: false,
          behaviour: 'asks open questions',
          type: 'HELPFUL',
        },
      ],
      [
        { category: 'SHOULD_DO', behaviour: 'Asks open questions' },
        { category: 'SHOULD_DO', behaviour: 'Names the feeling' },
      ],
    );
    expect(out.helpful).toEqual(['Names the feeling']);
    expect(out.competencies).toEqual([
      {
        name: 'Psychoeducation',
        helpful: ['Asks open questions'],
        unhelpful: [],
      },
    ]);
  });

  it('loadSession sends only named competencies as expectedBehaviours', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM scenario_sessions s')) {
        return [{ id: 's1', scenario_id: 4, competency_ids: ['c1', 'c3'] }];
      }
      if (sql.includes('FROM competencies c')) {
        return [
          {
            id: 'c1',
            name: 'Empathy',
            is_custom: false,
            behaviour: null,
            type: null,
          },
          {
            id: 'c3',
            name: '478_custom_27',
            is_custom: true,
            behaviour: 'Asks open questions',
            type: 'HELPFUL',
          },
        ];
      }
      if (sql.includes('scenario_behavior_instructions')) {
        return [{ category: 'SHOULD_DO', behaviour: 'Uses the client name' }];
      }
      return [];
    });
    const s = await new DebriefContextRepository({ query } as any).loadSession(
      's1',
    );
    expect(s?.expectedBehaviours).toEqual(['Empathy']);
    expect(s?.helpfulBehaviours).toEqual([
      'Uses the client name',
      'Asks open questions',
    ]);
    expect(s?.competencies).toEqual([
      { name: 'Empathy', helpful: [], unhelpful: [] },
    ]);
  });
});

const transcript = [
  { turn_index: 0, role: 'client' as const, text: 'I feel low.' },
  { turn_index: 1, role: 'counselor' as const, text: 'Tell me more.' },
];
const cards = (over: Partial<DebriefCards> = {}): DebriefCards => ({
  opening: 'You stayed with her.',
  what_worked: [
    {
      skill: 'Empathy',
      turn_index: 1,
      quote: 'Tell me more.',
      lead: 'You invited her to say more.',
      body: 'That helped.',
    },
  ],
  work_on_this: [
    {
      skill: '478_custom_27',
      turn_index: 1,
      quote: 'Tell me more.',
      lead: 'Try one more reflection.',
      why: 'It shows you heard her.',
      try_saying: 'It sounds heavy.',
    },
  ],
  practise_next: {
    skill: '478_custom_27',
    reason: 'Practise 478_custom_27 once more.',
    scenario_id: 3,
  },
  skill_words: [
    { skill: 'Empathy', word: 'strength' },
    { skill: '478_custom_27', word: 'keep_practising' },
  ],
  reflective_question: 'What did you notice?',
  ...over,
});

describe('a custom competency code in the cards', () => {
  it('is a check failure the Writer must fix', () => {
    const fails = runDebriefChecks({
      cards: cards(),
      transcript,
      safety: { risk_cues: [], learner_distress: [] },
      language: 'en',
      shortForm: false,
      hasProgress: false,
    }).filter((f) => f.code === DebriefCheckCode.CUSTOM_CODE);
    expect(fails.map((f) => f.section).sort()).toEqual([
      'practise_next',
      'skill_words',
      'work_on_this[0]',
    ]);
  });

  it('is replaced by the first helpful behaviour, or dropped, before publishing', () => {
    const named = publishableCards(
      cards(),
      new Map([['478_custom_27', 'Reflects feelings']]),
    );
    expect(customCodesIn(named)).toEqual([]);
    expect(named.practise_next?.skill).toBe('Reflects feelings');
    expect(named.work_on_this[0].skill).toBe('Reflects feelings');
    expect(named.practise_next?.reason).toBe('Practise once more.');

    const unknown = withoutCustomCodes(cards(), new Map());
    expect(customCodesIn(unknown)).toEqual([]);
    expect(unknown.practise_next).not.toHaveProperty('skill');
    expect(unknown.skill_words).toEqual([
      { skill: 'Empathy', word: 'strength' },
    ]);
  });

  it('is cleaned from an already-published debrief for its readers', async () => {
    const query = jest.fn(async () => [
      { code: '478_custom_27', behaviour: 'Reflects feelings' },
    ]);
    const read = await readableCards({ query }, cards());
    expect(read.practise_next?.skill).toBe('Reflects feelings');
    expect(customCodesIn(read)).toEqual([]);
    // Nothing to clean: no query at all.
    query.mockClear();
    const clean = cards({
      work_on_this: [],
      practise_next: null,
      skill_words: [],
    });
    expect(await readableCards({ query }, clean)).toBe(clean);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('Practise this again: try_next', () => {
  const withTry = (tryNext: string[]) =>
    cards({
      work_on_this: [],
      skill_words: [],
      practise_next: {
        skill: 'Empathy',
        reason: 'Do this roleplay again.',
        scenario_id: 3,
        try_next: tryNext,
      },
    });

  it('allows at most 3 short items', () => {
    const fails = runDebriefChecks({
      cards: withTry(['a', 'b', 'c', 'd']),
      transcript,
      safety: { risk_cues: [], learner_distress: [] },
      language: 'en',
      shortForm: false,
      hasProgress: false,
    });
    expect(
      fails.some(
        (f) =>
          f.code === DebriefCheckCode.STRUCTURE &&
          f.section === 'practise_next',
      ),
    ).toBe(true);
    expect(
      publishableCards(withTry(['a', ' ', 'b', 'c', 'd'])).practise_next
        ?.try_next,
    ).toEqual(['a', 'b', 'c']);
  });

  it('is read by the judge render and read aloud', () => {
    const c = withTry(['Name her feeling.', 'Ask what helps.']);
    expect(renderCards(c)).toContain(
      'Practise this again: Empathy. Do this roleplay again.\nTry the following:\n- Name her feeling.\n- Ask what helps.',
    );
    expect(sectionText(c, 'practise_next')).toBe(
      'Empathy. Do this roleplay again. Name her feeling. Ask what helps.',
    );
  });
});
