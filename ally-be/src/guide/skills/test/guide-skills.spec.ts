import { buildOrgSpan, buildSystemSpans } from '../../context/guide-context';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import {
  GUIDE_DEFAULT_SKILLS,
  GUIDE_SKILL_IDS,
  enabledSkills,
  skillIndex,
} from '../guide-skills';

describe('Ally skills (plan §7.6)', () => {
  it('ships the initial set, enabled and frozen in the release bundle', () => {
    expect(GUIDE_SKILL_IDS).toEqual([
      'debrief-heavy-roleplay',
      'support-after-a-hard-call',
      'explain-core-helping-skills',
      'voice-conversation-style',
      'org-protocol',
    ]);
    expect(Object.keys(GUIDE_DEFAULT_BUNDLE.skills)).toEqual(GUIDE_SKILL_IDS);
    expect(Object.keys(GUIDE_DEFAULT_BUNDLE.skillDefs ?? {})).toEqual(
      GUIDE_SKILL_IDS,
    );
  });

  it('puts the index, not the bodies, in S1', () => {
    const spans = buildSystemSpans(
      GUIDE_DEFAULT_BUNDLE,
      buildOrgSpan(null),
      '',
    );
    const s1 = spans.blocks[0].text;
    expect(s1).toContain('# Skills');
    for (const skill of GUIDE_DEFAULT_SKILLS) {
      expect(s1).toContain(`- ${skill.id}: ${skill.whenToUse}`);
      expect(s1).not.toContain(skill.instructions);
    }
  });

  it('reads a release from before skills as having none', () => {
    const old = { skills: {} };
    expect(enabledSkills(old)).toEqual([]);
    expect(skillIndex(enabledSkills(old))).toBe('');
  });

  it("prefers a release's frozen text, and falls back to the code default", () => {
    const frozen = enabledSkills({
      skills: { 'org-protocol': true, unknown: true },
      skillDefs: {
        'org-protocol': {
          version: 9,
          title: 'T',
          whenToUse: 'W',
          instructions: 'Frozen.',
        },
      },
    });
    expect(frozen).toEqual([
      {
        id: 'org-protocol',
        version: 9,
        title: 'T',
        whenToUse: 'W',
        instructions: 'Frozen.',
      },
    ]);
    const fallback = enabledSkills({ skills: { 'org-protocol': true } });
    expect(fallback[0].instructions).toMatch(/protocol decides/);
  });

  it('keeps each skill short enough to append as one tool result', () => {
    for (const skill of GUIDE_DEFAULT_SKILLS) {
      expect(skill.instructions.length).toBeLessThan(2_000);
      expect(skill.whenToUse.length).toBeLessThan(220);
    }
  });
});
