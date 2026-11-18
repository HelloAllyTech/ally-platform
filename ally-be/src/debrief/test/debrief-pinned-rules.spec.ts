import { BadRequestException } from '@nestjs/common';
import {
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefReleasesService } from '../service/debrief-releases.service';
import {
  PINNED_RULE_CODES,
  PINNED_RULE_PROMPTS,
} from '../util/debrief-console-view.util';
import { PM_AGENT_EDITABLE_PROMPTS } from '../constants/debrief-release.constants';
import { pinnedRuleName } from '../util/debrief-pinned-rules.util';
import { promptEditRefusal } from '../util/debrief-pm-agent-rules.util';

/**
 * Pinned rules (2026-11-18): ordinary Skills Store prompts that only the named pinned editors can
 * publish. No proposals, no approvals, no first-version items; the Debrief PM agent can never
 * edit one, and Settings › Pinned rules is a read-only list.
 */
const SAFETY = DEBRIEF_PROMPT_CODES.safetyReader;

describe('pinned rules: who can change them', () => {
  it('names seven rules, and the PM agent may edit none of them', () => {
    expect(PINNED_RULE_PROMPTS).toHaveLength(7);
    for (const code of PINNED_RULE_CODES) {
      expect(PM_AGENT_EDITABLE_PROMPTS.has(code)).toBe(false);
    }
  });

  it('refuses any PM-agent edit of a pinned prompt, the live text notwithstanding', () => {
    for (const code of PINNED_RULE_CODES) {
      expect(
        promptEditRefusal(code, 'a', 'b', 'a long enough text with a in it'),
      ).not.toBeNull();
    }
  });

  it('a release change (from a person or the PM agent) may never set a pinned rule’s version', async () => {
    const svc = new DebriefReleasesService(
      {} as any,
      {} as any,
      {} as any,
      {
        owner: jest.fn(),
      } as any,
    );
    const bundle = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    await expect(
      (svc as any).applyChanges(bundle, undefined, undefined, undefined, {
        [SAFETY]: 9,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      (svc as any).applyChanges(bundle, undefined, undefined, undefined, {
        [SAFETY]: 9,
      }),
    ).rejects.toThrow(/changed in the Skills Store by a pinned editor/);
  });
});

describe('Settings › Pinned rules (read-only)', () => {
  function view(rows: Record<string, any>) {
    const dataSource = {
      query: jest.fn(async (_sql: string, p: any[]) =>
        rows[p[0]] ? [rows[p[0]]] : [],
      ),
    };
    const pmAgent = {
      gaBundle: jest.fn(async () => ({
        bundle: { prompts: { [SAFETY]: 4 } },
      })),
    };
    const svc = new DebriefConsoleViewService(
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pmAgent as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, dataSource };
  }

  it('lists every rule with its version and who last changed it, and nothing to approve', async () => {
    const { svc, dataSource } = view({
      [SAFETY]: {
        promptId: 'p-1',
        version: 4,
        createdAt: new Date('2026-11-16T10:00:00Z'),
        createdBy: 7,
        createdByName: 'Asha',
      },
    });
    const out = await svc.pinnedRules();
    expect(Object.keys(out)).toEqual(['rules']);
    expect(out.rules).toHaveLength(7);
    expect(out.rules[0]).toEqual({
      code: SAFETY,
      label: 'Safety rules',
      version: 4,
      promptId: 'p-1',
      updatedAt: '2026-11-16T10:00:00.000Z',
      updatedBy: { id: 7, name: 'Asha' },
    });
    // A rule the store has no row for still shows, with nothing invented.
    expect(out.rules[1]).toMatchObject({
      version: null,
      promptId: null,
      updatedAt: null,
      updatedBy: null,
    });
    // The release's pinned version wins over the store's current one.
    expect((dataSource.query.mock.calls as any[][])[0][1]).toEqual([SAFETY, 4]);
  });
});

describe('pinned-rule changes already in the history', () => {
  it('names a rule without its explanation', () => {
    expect(pinnedRuleName(SAFETY)).toBe('Safety rules');
    expect(pinnedRuleName('debrief_quality_rubric')).toBe('Rubric');
    expect(pinnedRuleName('made_up')).toBe('made_up');
  });
});
