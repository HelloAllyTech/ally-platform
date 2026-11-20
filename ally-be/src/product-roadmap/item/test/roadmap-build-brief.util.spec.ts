import {
  BRIEF_DEEP_LINK_LIMIT,
  BUILD_BRIEF_FIELDS,
  BUILD_BRIEF_FORBIDDEN,
  briefBranch,
  pickBriefInput,
  renderBuildBrief,
} from '../roadmap-build-brief.util';

/**
 * The brief leaves for a public repo (D18). These sentinels sit in every
 * place a forbidden fact lives in the sources; none may reach the brief.
 */
const SECRET = {
  strategy: 'SENTINEL-STRATEGY-TEXT',
  rank: 'SENTINEL-RANK-RATIONALE',
  spend: 'SENTINEL-SPEND-417.25',
  transcript: 'SENTINEL-TRANSCRIPT-TURN',
  evidence: 'SENTINEL-PROD-NUMBER',
  decline: 'SENTINEL-DECLINE-REASON',
  baseline: 'SENTINEL-BASELINE-41%',
  review: 'SENTINEL-CRITIC-NOTES',
  existing: 'SENTINEL-EXISTING-BEHAVIOUR',
};

const prd = {
  title: 'Streak reminders',
  problem: 'Learners forget to come back after their first roleplay.',
  existingBehaviour: SECRET.existing,
  requirements: [
    {
      id: 'R1',
      title: 'Send a reminder',
      description: 'A reminder goes out on day two.',
      acceptanceCriteria: ['It sends once', 'It respects quiet hours'],
    },
    { id: 'R2', title: 'Agent wrote a string', acceptanceCriteria: 'oops' },
    { not: 'a requirement' },
  ],
  assumptions: [{ id: 'A1', text: 'x', evidence: { detail: SECRET.evidence } }],
  technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'x' }] },
  technicalDesign: {
    status: 'approved',
    designMd: 'Add a scheduled task.',
    scope: [
      { repo: 'ally-be', files: ['src/reminders/**'] },
      { repo: 'ally-web', files: ['apps/ally-admin-dashboard/src/x.tsx'] },
    ],
    contracts: [
      { name: 'reminders.sentAt', change: 'new column', readers: [] },
    ],
    compatibilityMd: 'Additive.',
    testMap: [
      {
        requirementId: 'R1',
        repo: 'ally-be',
        file: 'a.spec.ts',
        asserts: 'sends',
      },
    ],
    review: { verdict: 'pass', notesMd: SECRET.review },
  },
};

const sources = (over: Record<string, unknown> = {}) => ({
  code: 'OPP-0388',
  title: 'Streak reminders: day two',
  ideaProblem: 'Idea body',
  ideaOutcome: 'More learners return',
  successMeasure: {
    metric: 'Next-day return',
    target: '52%',
    baseline: SECRET.baseline,
  },
  prd,
  designApproved: true,
  // What a careless caller might hand over with the rest:
  whyRanks: { rationale: SECRET.rank },
  strategyContext: SECRET.strategy,
  spend: { spentUsd: SECRET.spend },
  messages: [{ content: SECRET.transcript }],
  declineReason: SECRET.decline,
  ...over,
});

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('a plan closed before it was ready', () => {
  it('prints the reason and the open blockers first', () => {
    const md = renderBuildBrief(
      pickBriefInput(
        sources({
          planClosed: {
            byUserId: 1,
            at: 'x',
            notReady: {
              reason: 'Pilot first; measure after.',
              blockers: ['Set a success measure.'],
            },
          },
        }) as never,
      ),
    );
    const closed = md.indexOf('## Closed before the plan was ready');
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(md.indexOf('## Branch and pull request'));
    expect(md).toContain(
      'Why it was closed anyway: Pilot first; measure after.',
    );
    expect(md).toContain('- Set a success measure.');
  });

  it('says nothing about it for a plan closed ready', () => {
    const input = pickBriefInput(
      sources({ planClosed: { byUserId: 1, at: 'x' } }) as never,
    );
    expect(input.closedNotReady).toBeNull();
    expect(renderBuildBrief(input)).not.toContain('Closed before');
  });
});

describe('build brief allowlist', () => {
  it('picks exactly the allowlisted fields', () => {
    const input = pickBriefInput(sources() as never);
    expect(Object.keys(input).sort()).toEqual([...BUILD_BRIEF_FIELDS].sort());
  });

  it('never carries a forbidden field, at any depth', () => {
    const keys = keysDeep(pickBriefInput(sources() as never));
    for (const forbidden of BUILD_BRIEF_FORBIDDEN) {
      expect({ forbidden, present: keys.has(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('never lets strategy, ranking, spend, transcript or other private text into the markdown', () => {
    const markdown = renderBuildBrief(pickBriefInput(sources() as never));
    for (const sentinel of Object.values(SECRET)) {
      expect(markdown).not.toContain(sentinel);
    }
  });

  it('carries the problem, outcome, requirements, approved design, paths, rules and the code instructions', () => {
    const markdown = renderBuildBrief(pickBriefInput(sources() as never));
    expect(markdown).toContain('# OPP-0388: Streak reminders: day two');
    expect(markdown).toContain(prd.problem);
    expect(markdown).toContain('Next-day return: 52%');
    expect(markdown).toContain('### R1. Send a reminder');
    expect(markdown).toContain('- [ ] It respects quiet hours');
    expect(markdown).toContain('Add a scheduled task.');
    expect(markdown).toContain('`reminders.sentAt`: new column');
    expect(markdown).toContain('- `ally-be/`: `src/reminders/**`');
    expect(markdown).toContain('`ally-web/`');
    expect(markdown).toContain('ai-task-registry.constants.ts');
    expect(markdown).toContain('`opp-0388-streak-reminders-day-two`');
    expect(markdown).toContain('`OPP-0388: Streak reminders: day two`');
  });

  it('survives agent-written lists that are not lists', () => {
    const input = pickBriefInput(sources() as never);
    expect(input.requirements.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(input.requirements[1].acceptanceCriteria).toEqual([]);
  });

  it('leaves out a design that is not approved, and falls back to the planned apps', () => {
    const input = pickBriefInput(sources({ designApproved: false }) as never);
    expect(input.design).toBeNull();
    expect(input.touched).toEqual([{ repo: 'ally-be', paths: [] }]);
    expect(renderBuildBrief(input)).not.toContain('Add a scheduled task.');
  });

  it('falls back to the idea text when there is no PRD', () => {
    const input = pickBriefInput(
      sources({ prd: null, successMeasure: null }) as never,
    );
    expect(input.problem).toBe('Idea body');
    expect(input.outcome).toBe('More learners return');
    expect(renderBuildBrief(input)).toContain(
      '_No requirements in the PRD yet._',
    );
  });

  it('names a branch the PR linker will find', () => {
    expect(briefBranch('OPP-0388', '  Fix: the -- thing!  ')).toBe(
      'opp-0388-fix-the-thing',
    );
    expect(briefBranch('OPP-0001', '')).toBe('opp-0001');
    expect(BRIEF_DEEP_LINK_LIMIT).toBe(14000);
  });
});
