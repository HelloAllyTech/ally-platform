import { FIRST_PRINCIPLES_PROFILE } from '../../profiles/first-principles.profile';
import { ClChunkConfidence } from '../../enum/context-library.enum';
import { wordRuns } from '../../util/gate.util';
import { ContextExtractionService } from '../context-extraction.service';

// `decide` is pure; the constructor's collaborators are never touched by it.
const service = new (ContextExtractionService as any)(
  ...Array.from({ length: 13 }, () => ({})),
) as ContextExtractionService;

const candidate = service.toGateCandidate(FIRST_PRINCIPLES_PROFILE, {
  statement: "Design a list view's empty state before its populated state",
  situations: ['a list can have zero items'],
  exampleQueries: ['zero state'],
  keywords: ['empty state'],
  topics: ['Empty States'],
  domain: 'ux_ui',
  prdSections: ['ux_states'],
  kind: 'rule',
  strength: 'must',
  rationale: 'New users see it first.',
});
const runs = wordRuns(
  'Some unrelated segment text about onboarding flows and lists.',
);

const pass = {
  index: 0,
  grounded: 'supported' as const,
  standalone: true,
  specificity: 4,
  actionability: 4,
  names: [],
  checks: {},
};

describe('ContextExtractionService.decide', () => {
  it('maps extractor output onto the profile, normalising free tags', () => {
    expect(candidate.facets).toEqual({
      domain: 'ux_ui',
      prdSections: ['ux_states'],
    });
    expect(candidate.topics).toEqual(['empty-states']);
    expect(candidate.attributes).toMatchObject({
      kind: 'rule',
      strength: 'must',
    });
  });

  it('publishes a supported, standalone, specific candidate at standard confidence', () => {
    const d = service.decide(
      FIRST_PRINCIPLES_PROFILE,
      candidate,
      [],
      pass,
      runs,
    );
    expect(d.reject).toBeUndefined();
    expect(d.confidence).toBe(ClChunkConfidence.STANDARD);
  });

  it('rejects ungrounded candidates and anything naming a person', () => {
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        candidate,
        [],
        { ...pass, grounded: 'unsupported' },
        runs,
      ).reject,
    ).toBe('ungrounded');
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        candidate,
        [],
        { ...pass, names: ['Jane Smith'] },
        runs,
      ).reject,
    ).toBe('names');
    expect(
      service.decide(FIRST_PRINCIPLES_PROFILE, candidate, [], undefined, runs)
        .reject,
    ).toBe('critic_missing');
  });

  it('publishes borderline candidates at low confidence rather than holding them for a person', () => {
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        candidate,
        [],
        { ...pass, grounded: 'partial' },
        runs,
      ).confidence,
    ).toBe(ClChunkConfidence.LOW);
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        candidate,
        [],
        { ...pass, specificity: 2 },
        runs,
      ).confidence,
    ).toBe(ClChunkConfidence.LOW);
  });

  it('uses the critic rewrite when a candidate does not stand alone', () => {
    const d = service.decide(
      FIRST_PRINCIPLES_PROFILE,
      { ...candidate, statement: 'Apply this approach to every list' },
      ['unresolved_reference'],
      {
        ...pass,
        standalone: false,
        rewrite: 'Give every list view a designed empty state',
      },
      runs,
    );
    expect(d.reject).toBeUndefined();
    expect(d.candidate.statement).toBe(
      'Give every list view a designed empty state',
    );
    expect(d.confidence).toBe(ClChunkConfidence.STANDARD);
  });

  it('rejects a failed stereotype or identifiability check, and any doubt about a sensitive chunk', () => {
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        candidate,
        [],
        { ...pass, checks: { identifiability: 'fail' } },
        runs,
      ).reject,
    ).toBe('identifiability');
    const sensitive = {
      ...candidate,
      facets: { ...candidate.facets, sensitivity: 'sensitive' },
    };
    expect(
      service.decide(
        FIRST_PRINCIPLES_PROFILE,
        sensitive,
        [],
        { ...pass, checks: { clinical_plausibility: 'doubt' } },
        runs,
      ).reject,
    ).toBe('sensitive_doubt');
  });
});
