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

describe('agent-written collections (phase 5)', () => {
  const { BUILDER_LESSONS_PROFILE } = require('../builder-lessons.profile');
  const { BUG_HUNTER_NOTES_PROFILE } = require('../bug-hunter-notes.profile');

  it('registers Builder Lessons and Bug Hunter Notes with their codes and nouns', () => {
    expect(requireProfile(ClCollectionId.BUILDER_LESSONS)).toBe(
      BUILDER_LESSONS_PROFILE,
    );
    expect(BUILDER_LESSONS_PROFILE.codePrefix).toBe('BL');
    expect(BUILDER_LESSONS_PROFILE.noun).toBe('lesson');
    expect(requireProfile(ClCollectionId.BUG_HUNTER_NOTES)).toBe(
      BUG_HUNTER_NOTES_PROFILE,
    );
    expect(BUG_HUNTER_NOTES_PROFILE.codePrefix).toBe('BN');
    expect(BUG_HUNTER_NOTES_PROFILE.noun).toBe('note');
    for (const profile of [BUILDER_LESSONS_PROFILE, BUG_HUNTER_NOTES_PROFILE]) {
      expect(profile.allowedOrigins).toEqual(['agent', 'authored']);
      expect(profile.extraction).toBeUndefined();
      expect(profile.agentCuration.activeCap).toBeGreaterThan(0);
      expect(profile.purpose.length).toBeGreaterThan(80);
    }
  });

  it('reaches the use cases the plan grants them, engineers included', () => {
    for (const useCase of [
      ClUseCase.BUILDER_INTERVIEW,
      ClUseCase.BUILDER_RESEARCH,
      ClUseCase.BUILDER_PRD_REVIEW,
      ClUseCase.BUILDER_BRIEF,
      ClUseCase.BUILDER_BUILD,
      ClUseCase.MCP_DEV,
    ]) {
      expect(CONTEXT_USE_CASES[useCase].defaultCollections).toContain(
        ClCollectionId.BUILDER_LESSONS,
      );
    }
    for (const useCase of [ClUseCase.BUG_HUNTER, ClUseCase.MCP_DEV]) {
      expect(CONTEXT_USE_CASES[useCase].defaultCollections).toContain(
        ClCollectionId.BUG_HUNTER_NOTES,
      );
    }
  });

  it('keeps Builder’s lesson categories as the category vocabulary', () => {
    expect([...BUILDER_LESSONS_PROFILE.facets.category.values]).toEqual([
      'gotcha',
      'convention',
      'estimate',
      'process',
    ]);
  });

  it('renders cards with the code, scope and band', () => {
    const view = {
      code: 'BL-0012',
      statement: 'Run NX_DAEMON=false before the admin suite on CI.',
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: [],
      facets: { category: 'gotcha', repos: ['ally-web'], tags: ['ci'] },
      attributes: {},
    };
    expect(BUILDER_LESSONS_PROFILE.card(view, 'strong')).toBe(
      '[BL-0012 · gotcha · ally-web · strong] Run NX_DAEMON=false before the admin suite on CI.',
    );
    expect(
      BUG_HUNTER_NOTES_PROFILE.card({ ...view, code: 'BN-0003', facets: {} }),
    ).toBe(
      '[BN-0003 · platform] Run NX_DAEMON=false before the admin suite on CI.',
    );
  });
});

describe('Ally Guide Library and Debrief Guidance (phase 6)', () => {
  const {
    ALLY_GUIDE_LIBRARY_PROFILE,
  } = require('../ally-guide-library.profile');
  const { DEBRIEF_GUIDANCE_PROFILE } = require('../debrief-guidance.profile');

  it('registers both with their codes, nouns and origins', () => {
    expect(requireProfile(ClCollectionId.ALLY_GUIDE_LIBRARY)).toBe(
      ALLY_GUIDE_LIBRARY_PROFILE,
    );
    expect(ALLY_GUIDE_LIBRARY_PROFILE.codePrefix).toBe('AG');
    expect(ALLY_GUIDE_LIBRARY_PROFILE.noun).toBe('entry');
    expect(requireProfile(ClCollectionId.DEBRIEF_GUIDANCE)).toBe(
      DEBRIEF_GUIDANCE_PROFILE,
    );
    expect(DEBRIEF_GUIDANCE_PROFILE.codePrefix).toBe('DG');
    expect(DEBRIEF_GUIDANCE_PROFILE.noun).toBe('guideline');
    for (const profile of [
      ALLY_GUIDE_LIBRARY_PROFILE,
      DEBRIEF_GUIDANCE_PROFILE,
    ]) {
      expect([...profile.allowedOrigins].sort()).toEqual([
        'authored',
        'distilled',
        'imported',
      ]);
      expect(profile.extraction.promptCode).toMatch(
        /^context_library_extract_/,
      );
      expect(profile.purpose.length).toBeGreaterThan(80);
      // Information only: a flag the Library shows, never a gate.
      expect(profile.attributes.clinical).toMatchObject({
        type: 'bool',
        shown: true,
      });
      expect(profile.attributes.clinical.required).toBeFalsy();
    }
  });

  it('lets organisations write to the guide library only', () => {
    expect(ALLY_GUIDE_LIBRARY_PROFILE.allowsOrgChunks).toBe(true);
    expect(DEBRIEF_GUIDANCE_PROFILE.allowsOrgChunks).toBe(false);
    expect(
      Object.values(COLLECTION_PROFILES)
        .filter((p) => p?.allowsOrgChunks)
        .map((p) => p!.id),
    ).toEqual([ClCollectionId.ALLY_GUIDE_LIBRARY]);
  });

  it('is never granted to engineers, and reaches the guide and Debrief only', () => {
    for (const profile of [
      ALLY_GUIDE_LIBRARY_PROFILE,
      DEBRIEF_GUIDANCE_PROFILE,
    ]) {
      expect(profile.neverGrantTo).toContain(ClUseCase.MCP_DEV);
    }
    expect(CONTEXT_USE_CASES[ClUseCase.DEBRIEF].defaultCollections).toEqual([
      ClCollectionId.DEBRIEF_GUIDANCE,
    ]);
    for (const useCase of [ClUseCase.ALLY_GUIDE, ClUseCase.DEBRIEF]) {
      expect(CONTEXT_USE_CASES[useCase].querySensitive).toBe(true);
    }
  });

  it('puts the passage and its citation on the card, word for word', () => {
    const body =
      'Call the duty supervisor first. Then write down what was said, in their words.';
    const card = ALLY_GUIDE_LIBRARY_PROFILE.card(
      {
        code: 'AG-0012',
        statement: 'Who to call when a learner is at risk',
        body,
        situations: [],
        exampleQueries: [],
        keywords: [],
        topics: [],
        facets: { kind: 'protocol' },
        attributes: {},
        citation: {
          title: 'Escalation protocol',
          sectionPath: 'Out of hours',
          pageFrom: 4,
          pageTo: 5,
        },
      },
      'good',
    );
    expect(card).toContain('[AG-0012 · protocol · good]');
    expect(card).toContain('From: Escalation protocol, Out of hours, pp. 4–5');
    expect(card).toContain(body);

    const guideline = DEBRIEF_GUIDANCE_PROFILE.card({
      code: 'DG-0003',
      statement: 'Ask about safety directly',
      body: null,
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: [],
      facets: { kind: 'practice_guideline' },
      attributes: { clinical: true, detail: 'Ask plainly and calmly.' },
      citation: { title: 'Risk guide', pageFrom: 2 },
    });
    expect(guideline).toContain('[DG-0003 · practice_guideline · clinical]');
    expect(guideline).toContain('From: Risk guide, p. 2');
    expect(guideline).toContain('Ask plainly and calmly.');
  });

  it('indexes the opening of a body, so an imported passage is found before it is enriched', () => {
    const view = {
      code: 'DG-0004',
      statement: 'Risk guide — Asking about suicide',
      body: 'Asking directly about suicide does not plant the idea.',
      situations: [],
      exampleQueries: [],
      keywords: [],
      topics: [],
      facets: {},
      attributes: {},
    };
    expect(DEBRIEF_GUIDANCE_PROFILE.situationsText(view)).toContain(
      'does not plant the idea',
    );
    expect(DEBRIEF_GUIDANCE_PROFILE.statementText(view)).toContain(
      'Asking directly',
    );
  });

  it('keeps the Debrief levels in step with the learner levels a debrief is pitched at', () => {
    expect([...DEBRIEF_GUIDANCE_PROFILE.facets.level.values]).toEqual([
      'lay',
      'early_professional',
      'experienced_professional',
    ]);
  });
});
