import { CONTEXT_USE_CASES } from '../../constants/context-use-cases.constants';
import { ClCollectionId, ClUseCase } from '../../enum/context-library.enum';
import {
  CHARACTER_INSIGHTS_PROFILE,
  CHARACTER_INSIGHT_ASPECTS,
} from '../character-insights.profile';
import { FIRST_PRINCIPLES_PROFILE } from '../first-principles.profile';
import {
  COLLECTION_PROFILES,
  CRITIC_CHECKS,
  facetValues,
  indexCollectionName,
  requireProfile,
} from '../index';

describe('collection profiles', () => {
  it('names index collections the way ally-ai validates them', () => {
    expect(indexCollectionName('first_principles', 1)).toBe(
      'CtxFirstPrinciples_v1',
    );
    expect(indexCollectionName('bug_hunter_notes', 12)).toBe(
      'CtxBugHunterNotes_v12',
    );
    expect(indexCollectionName('first_principles', 3)).toMatch(
      /^Ctx[A-Z][A-Za-z]+_v[0-9]+$/,
    );
  });

  it('keeps every profile consistent with its id and code prefix', () => {
    for (const [id, profile] of Object.entries(COLLECTION_PROFILES)) {
      expect(profile!.id).toBe(id);
      expect(profile!.codePrefix).toMatch(/^[A-Z]{2}$/);
    }
    expect(() => requireProfile('nonexistent')).toThrow();
  });

  it('never grants a locked collection by default', () => {
    for (const spec of Object.values(CONTEXT_USE_CASES)) {
      for (const collection of spec.defaultCollections) {
        const profile = COLLECTION_PROFILES[collection];
        if (profile) expect(profile.neverGrantTo).not.toContain(spec.id);
      }
    }
  });

  it('renders a compact card and both index texts', () => {
    const chunk = {
      code: 'FP-0142',
      statement: "Design a list view's empty state before its populated state",
      situations: ['a list can have zero items'],
      exampleQueries: ['zero state'],
      keywords: [],
      topics: [],
      facets: { domain: 'ux_ui' },
      attributes: {
        rationale: 'It is the first thing new users see.',
        strength: 'must',
        probe: 'What do new users see?',
      },
    };
    expect(FIRST_PRINCIPLES_PROFILE.card(chunk, 'strong')).toBe(
      "[FP-0142 · must · ux_ui · strong] Design a list view's empty state before its populated state\n  When: a list can have zero items",
    );
    expect(FIRST_PRINCIPLES_PROFILE.statementText(chunk)).toContain('ux_ui:');
    expect(FIRST_PRINCIPLES_PROFILE.situationsText(chunk)).toContain(
      'zero state',
    );
    expect(
      facetValues({ domain: 'ux_ui', prdSections: ['scope', 'api'] }),
    ).toEqual(['domain:ux_ui', 'prdSections:scope', 'prdSections:api']);
  });

  it('covers every use case', () => {
    expect(Object.keys(CONTEXT_USE_CASES).sort()).toEqual(
      Object.values(ClUseCase).sort(),
    );
    expect(CONTEXT_USE_CASES[ClUseCase.ALLY_GUIDE].defaultCollections).toEqual([
      ClCollectionId.ALLY_GUIDE_LIBRARY,
    ]);
  });
});

describe('Character Insights profile', () => {
  it('is locked away from engineers and reachable by the character interview', () => {
    expect(CHARACTER_INSIGHTS_PROFILE.codePrefix).toBe('CI');
    expect(CHARACTER_INSIGHTS_PROFILE.neverGrantTo).toContain(
      ClUseCase.MCP_DEV,
    );
    expect(
      CONTEXT_USE_CASES[ClUseCase.CHARACTER_INTERVIEW].defaultCollections,
    ).toEqual([ClCollectionId.CHARACTER_INSIGHTS]);
    expect(
      CONTEXT_USE_CASES[ClUseCase.CHARACTER_INTERVIEW].querySensitive,
    ).toBe(true);
  });

  it('keeps the five aspects the interview searches by, each with a label', () => {
    expect([...CHARACTER_INSIGHT_ASPECTS]).toEqual([
      'identity',
      'life_context',
      'inner_life',
      'history_and_presenting_concern',
      'speech_and_language',
    ]);
    const aspect = CHARACTER_INSIGHTS_PROFILE.facets.aspect;
    for (const value of aspect.values!) {
      expect(aspect.valueLabels?.[value]).toBeTruthy();
    }
  });

  it('renders a card with the code, aspect, detail and a voice sample', () => {
    const card = CHARACTER_INSIGHTS_PROFILE.card(
      {
        code: 'CI-0007',
        statement: 'Early word-finding trouble shows as talking around a word',
        situations: [],
        exampleQueries: [],
        keywords: [],
        topics: [],
        facets: { aspect: 'speech_and_language', basis: 'lived_experience' },
        attributes: {
          detail: 'Describing what a thing does instead of naming it.',
          voiceSamples: ['The thing you boil water in.'],
          avoid: 'Making confusion the whole personality.',
        },
      },
      'good',
    );
    expect(card).toContain(
      '[CI-0007 · speech_and_language · lived_experience · good]',
    );
    expect(card).toContain('Looks like: Describing what a thing does');
    expect(card).toContain('"The thing you boil water in."');
    expect(card).toContain('Avoid: Making confusion');
  });
});

describe('critic checks', () => {
  it('defines every check a profile asks the critic for', () => {
    for (const profile of Object.values(COLLECTION_PROFILES)) {
      for (const check of profile?.extraction?.criticChecks ?? []) {
        expect(CRITIC_CHECKS[check]).toBeTruthy();
      }
    }
    expect(CHARACTER_INSIGHTS_PROFILE.extraction?.criticChecks).toEqual(
      expect.arrayContaining(['identifiability', 'stereotype']),
    );
  });
});

describe('profile prompt codes', () => {
  it('point at prompts that have a contract', () => {
    const { PROMPT_CONTRACTS } = require('src/prompt/contracts');
    const codes = new Set(
      Object.values(PROMPT_CONTRACTS as Record<string, { code: string }>).map(
        (c) => c.code,
      ),
    );
    for (const profile of Object.values(COLLECTION_PROFILES)) {
      if (profile?.extraction) {
        expect(codes).toContain(profile.extraction.promptCode);
      }
    }
  });
});
