import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import {
  firstVersionTitle,
  passageProblem,
  pinnedRuleActions,
  textAfterChange,
} from '../util/debrief-pinned-rules.util';
import { approvalState, ideaState } from '../util/debrief-console-view.util';

/**
 * Pinned rules' approval flow (debrief-console-redesign-notes.md, "Pinned
 * rules: approval flow"): first-version items, approval, withdraw, reject,
 * self-approval, and the whole rule with the change highlighted.
 *
 * The service runs against a small in-memory `agent_lessons` that answers
 * the SQL it issues, so the idempotency and the evidence are checked on the
 * rows themselves.
 */
const SAFETY = 'debrief_safety_reader_system';
const RUBRIC = 'debrief_quality_rubric';
const JUDGE = 'debrief_quality_judge_system';
const ADVISOR = 7;
const OWNER = 9;

type Row = Record<string, any>;

function build(opts: { versions?: Record<string, number> } = {}) {
  const versions: Record<string, number> = {
    [SAFETY]: 1,
    [RUBRIC]: 1,
    [JUDGE]: 1,
    ...opts.versions,
  };
  const texts: Record<string, string> = {
    [SAFETY]: 'Find every risk cue. Name the moment. Say how they responded.',
    [RUBRIC]: 'Score eight dimensions.',
    [JUDGE]: 'List the risk cues first.',
  };
  const lessons: Row[] = [];
  const audit: Row[] = [];
  let seq = 0;
  const query = jest.fn(async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('SELECT pv.version, pv.prompt FROM prompts')) {
      const code = p[0];
      return code in versions
        ? [{ version: p[1] ?? versions[code], prompt: texts[code] }]
        : [];
    }
    if (s.startsWith('INSERT INTO agent_lesson_audit')) {
      audit.push({
        lessonId: p[1],
        action: p[2],
        userId: p[4],
        detail: JSON.parse(p[5]),
      });
      return [];
    }
    if (
      s.includes(
        'SET status = \'retired\', "updatedAt" = now() WHERE "agentKey"',
      )
    ) {
      for (const l of lessons) {
        if (
          l.status === 'proposed' &&
          l.change.firstVersion &&
          l.change.promptCode === p[1] &&
          l.change.version !== p[2]
        )
          l.status = 'retired';
      }
      return [];
    }
    if (
      s.includes(
        "evidence ? 'signoff' AND (evidence->'signoff'->>'promptVersion')",
      )
    ) {
      return lessons
        .filter(
          (l) =>
            l.change.promptCode === p[1] &&
            l.evidence.signoff?.promptVersion === p[2],
        )
        .map(() => ({ '?column?': 1 }));
    }
    if (s.includes('ON CONFLICT ("agentKey", "contentHash")')) {
      if (lessons.some((l) => l.change.firstVersion && l.contentHash === p[3]))
        return [];
      const row = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        agentKey: p[0],
        status: 'proposed',
        text: p[1],
        change: JSON.parse(p[2]),
        evidence: {},
        contentHash: p[3],
        createdAt: new Date().toISOString(),
      };
      lessons.push(row);
      return [{ id: row.id }];
    }
    if (
      s.includes('INSERT INTO agent_lessons') &&
      s.includes('WHERE NOT EXISTS')
    ) {
      if (lessons.some((l) => l.contentHash === p[4])) return [];
      const row = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        status: 'proposed',
        text: p[1],
        change: JSON.parse(p[2]),
        evidence: JSON.parse(p[3]),
        contentHash: p[4],
        createdAt: new Date().toISOString(),
      };
      lessons.push(row);
      return [{ id: row.id }];
    }
    if (s.startsWith('SELECT * FROM agent_lessons WHERE id = $1')) {
      return lessons.filter((l) => l.id === p[0]);
    }
    if (s.includes('SET evidence = evidence || jsonb_build_object')) {
      const l = lessons.find((x) => x.id === p[0]);
      if (l) l.evidence = { ...l.evidence, [p[1]]: JSON.parse(p[2]) };
      return [];
    }
    const status = /SET status = '(\w+)'/.exec(s)?.[1];
    if (status && s.includes('WHERE id = $1')) {
      const l = lessons.find((x) => x.id === p[0]);
      if (l) {
        l.status = status;
        if (p[1] != null) l.decidedBy = p[1];
        if (p[2] !== undefined) l.releaseId = p[2];
      }
      return [];
    }
    if (s.startsWith('SELECT id FROM prompts WHERE "promptCode"')) {
      return [{ id: `prompt-${p[0]}` }];
    }
    throw new Error(`unexpected SQL: ${s.slice(0, 120)}`);
  });
  const bundle = {
    prompts: { [SAFETY]: null, [RUBRIC]: null },
  };
  const createVersion = jest.fn(async () => ({ version: 2 }));
  const createDraft = jest.fn(async () => ({ id: 'rel-draft', version: 12 }));
  const svc = new DebriefPmAgentService(
    { query } as any,
    {
      promptText: jest.fn(async (code: string) => texts[code] ?? null),
    } as any,
    {
      resolveRelease: jest.fn(async () => ({ release: { id: 'ga' }, bundle })),
      pinPrompts: jest.fn(async () => undefined),
    } as any,
    {} as any,
    {} as any,
    { createDraft } as any,
    { latestVersionOf: jest.fn(async () => 1), createVersion } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, lessons, audit, versions, createVersion, createDraft };
}

const firstVersions = (lessons: Row[]) =>
  lessons.filter((l) => l.change.firstVersion);

describe('pinned rules: first-version items', () => {
  it('makes one "Needs you" item per unapproved rule, titled by its version', async () => {
    const { svc, lessons } = build();
    expect(await svc.ensureFirstVersionItems(true)).toBe(3);
    expect(
      firstVersions(lessons)
        .map((l) => l.text)
        .sort(),
    ).toEqual([
      "Approve the current Judge's instructions (v1)",
      'Approve the current Rubric (v1)',
      'Approve the current Safety rules (v1)',
    ]);
    expect(firstVersionTitle(SAFETY, 1)).toBe(
      'Approve the current Safety rules (v1)',
    );
  });

  it('is idempotent: asked again (or by another instance), it makes none', async () => {
    const { svc, lessons } = build();
    await svc.ensureFirstVersionItems(true);
    expect(await svc.ensureFirstVersionItems(true)).toBe(0);
    expect(firstVersions(lessons)).toHaveLength(3);
  });

  it('makes none once that version is approved', async () => {
    const { svc, lessons } = build();
    await svc.ensureFirstVersionItems(true);
    const safety = firstVersions(lessons).find(
      (l) => l.change.promptCode === SAFETY,
    )!;
    await svc.approvePinnedRule(safety.id, ADVISOR);
    // Another instance's unique index would refuse a duplicate anyway; drop
    // the row's hash so only the approval check stands between it and a new item.
    safety.contentHash = 'gone';
    expect(await svc.ensureFirstVersionItems(true)).toBe(0);
  });

  it('never expires and has no Reject', () => {
    const idea = {
      status: 'proposed',
      createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      change: { ideaKind: 'pinned_rule', firstVersion: true },
      evidence: {},
    };
    const a = approvalState(idea);
    expect(a).toMatchObject({
      wait: 'pinned_rule',
      expired: false,
      expiresAt: null,
    });
    expect(
      pinnedRuleActions({
        open: true,
        firstVersion: true,
        mine: false,
        mayDecide: true,
      }),
    ).toEqual({
      approve: true,
      reject: false,
      withdraw: false,
      askForChange: true,
    });
  });

  it('approving records who and when, and makes no new prompt version or release', async () => {
    const { svc, lessons, audit, createVersion, createDraft } = build();
    await svc.ensureFirstVersionItems(true);
    const rubric = firstVersions(lessons).find(
      (l) => l.change.promptCode === RUBRIC,
    )!;
    const res = await svc.approvePinnedRule(rubric.id, OWNER);
    expect(res.promptVersion).toBe(1);
    expect(createVersion).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
    expect(rubric.status).toBe('approved');
    expect(rubric.evidence.signoff).toMatchObject({
      by: OWNER,
      promptCode: RUBRIC,
      promptVersion: 1,
      firstVersion: true,
    });
    expect(typeof rubric.evidence.signoff.at).toBe('string');
    expect(audit.at(-1)).toMatchObject({ action: 'approved', userId: OWNER });
  });

  it('cannot be rejected or withdrawn', async () => {
    const { svc, lessons } = build();
    await svc.ensureFirstVersionItems(true);
    const id = firstVersions(lessons)[0].id;
    await expect(svc.rejectPinnedRule(id, OWNER, 'no')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.withdrawPinnedRule(id, OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('retires an open item for a version no longer in force', async () => {
    const { svc, lessons, versions } = build();
    await svc.ensureFirstVersionItems(true);
    versions[SAFETY] = 2;
    expect(await svc.ensureFirstVersionItems(true)).toBe(1);
    const safety = firstVersions(lessons).filter(
      (l) => l.change.promptCode === SAFETY,
    );
    expect(safety.map((l) => [l.change.version, l.status])).toEqual([
      [1, 'retired'],
      [2, 'proposed'],
    ]);
  });
});

describe('pinned rules: proposals', () => {
  const propose = (
    svc: DebriefPmAgentService,
    by: number,
    replace = 'Name every moment.',
  ) =>
    svc.proposePinnedRule(
      { promptCode: SAFETY, find: 'Name the moment.', replace, why: 'Clearer' },
      by,
    );

  it('says plainly when the passage is missing or not unique', async () => {
    const { svc } = build();
    await expect(
      svc.proposePinnedRule(
        { promptCode: SAFETY, find: 'not there', replace: 'x', why: 'y' },
        ADVISOR,
      ),
    ).rejects.toThrow('That passage is not in the current rule');
    await expect(
      svc.proposePinnedRule(
        { promptCode: SAFETY, find: '. ', replace: 'x', why: 'y' },
        ADVISOR,
      ),
    ).rejects.toThrow('appears more than once');
    expect(passageProblem('a b a', 'a')).toBe('not_unique');
    expect(passageProblem('a b', '  ')).toBe('empty');
  });

  it('the proposer may approve their own proposal: a new version and a DRAFT release', async () => {
    const { svc, lessons, createVersion, createDraft } = build();
    const { id } = await propose(svc, ADVISOR);
    const res = await svc.approvePinnedRule(id, ADVISOR);
    expect(createVersion).toHaveBeenCalledWith(
      `prompt-${SAFETY}`,
      expect.objectContaining({
        body: 'Find every risk cue. Name every moment. Say how they responded.',
      }),
      { translate: 'none' },
    );
    expect(createDraft).toHaveBeenCalled();
    expect(res.releaseId).toBe('rel-draft');
    const idea = lessons.find((l) => l.id === id)!;
    expect(idea.status).toBe('approved');
    expect(idea.evidence.signoff).toMatchObject({
      by: ADVISOR,
      promptVersion: 2,
    });
  });

  it('withdraw: only by the person who proposed it, closed as withdrawn and audited', async () => {
    const { svc, lessons, audit } = build();
    const { id } = await propose(svc, ADVISOR);
    await expect(svc.withdrawPinnedRule(id, OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await svc.withdrawPinnedRule(id, ADVISOR);
    const idea = lessons.find((l) => l.id === id)!;
    expect(idea.status).toBe('retired');
    expect(idea.evidence.withdrawn).toMatchObject({ by: ADVISOR });
    expect(ideaState(idea)).toMatchObject({
      state: 'closed',
      closedReason: 'withdrawn',
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'retired',
      userId: ADVISOR,
      detail: { kind: 'pinned_rule', withdrawn: true },
    });
    await expect(svc.withdrawPinnedRule(id, ADVISOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reject: someone else, with a reason kept on the idea for the PM agent', async () => {
    const { svc, lessons, audit } = build();
    const { id } = await propose(svc, ADVISOR);
    await expect(svc.rejectPinnedRule(id, OWNER, '  ')).rejects.toThrow(
      'Say why',
    );
    await expect(
      svc.rejectPinnedRule(id, ADVISOR, 'mine'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await svc.rejectPinnedRule(id, OWNER, 'Too vague for a safety rule');
    const idea = lessons.find((l) => l.id === id)!;
    expect(idea.status).toBe('rejected');
    expect(idea.evidence.rejection).toMatchObject({
      by: OWNER,
      reason: 'Too vague for a safety rule',
    });
    expect(audit.at(-1)).toMatchObject({
      action: 'rejected',
      detail: { reason: 'Too vague for a safety rule', kind: 'pinned_rule' },
    });
  });

  it('the Ally team’s reject route refuses a pinned rule', async () => {
    const { svc } = build();
    const { id } = await propose(svc, ADVISOR);
    await expect(svc.reject(id, 1)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('pinned rules: the whole rule on the item', () => {
  it('highlights the replacement inside the text as it would read', () => {
    expect(textAfterChange('A b. C d. E f.', 'C d.', 'C, d!')).toEqual({
      segments: [
        { text: 'A b. ', changed: false },
        { text: 'C, d!', changed: true },
        { text: ' E f.', changed: false },
      ],
      stale: false,
    });
    expect(textAfterChange('gone', 'C d.', 'x')).toEqual({
      segments: [{ text: 'gone', changed: false }],
      stale: true,
    });
  });

  it('carries the text, the other open proposals and the buttons per item', async () => {
    const { svc, lessons } = build();
    await svc.ensureFirstVersionItems(true);
    const mine = await svc.proposePinnedRule(
      {
        promptCode: SAFETY,
        find: 'Name the moment.',
        replace: 'Name it.',
        why: 'w',
      },
      ADVISOR,
    );
    const theirs = await svc.proposePinnedRule(
      {
        promptCode: SAFETY,
        find: 'Find every risk cue.',
        replace: 'Find all cues.',
        why: 'w',
      },
      OWNER,
    );
    const ideas = lessons.map((l) => ({ ...l }));
    await svc.pinnedRuleDetails(ideas, {
      userId: ADVISOR,
      can: { approvePinnedRule: true },
    });
    const by = (id: string) => ideas.find((i) => i.id === id)!;
    const first = ideas.find(
      (i) => i.change.firstVersion && i.change.promptCode === SAFETY,
    )!;
    expect(first.pinnedRule).toMatchObject({
      firstVersion: true,
      liveVersion: 1,
      otherOpen: 2,
      segments: [
        {
          text: 'Find every risk cue. Name the moment. Say how they responded.',
          changed: false,
        },
      ],
    });
    expect(first.can).toMatchObject({
      approve: true,
      reject: false,
      withdraw: false,
      askForChange: true,
    });
    expect(by(mine.id).can).toMatchObject({
      approve: true,
      reject: false,
      withdraw: true,
      askForChange: false,
    });
    expect(by(mine.id).pinnedRule.otherOpen).toBe(1);
    expect(by(mine.id).pinnedRule.segments).toEqual([
      { text: 'Find every risk cue. ', changed: false },
      { text: 'Name it.', changed: true },
      { text: ' Say how they responded.', changed: false },
    ]);
    expect(by(theirs.id).can).toMatchObject({
      approve: true,
      reject: true,
      withdraw: false,
      askForChange: true,
    });
  });

  it('the Ally team alone sees no buttons on a pinned rule', async () => {
    const { svc, lessons } = build();
    await svc.ensureFirstVersionItems(true);
    const ideas = lessons.map((l) => ({ ...l }));
    await svc.pinnedRuleDetails(ideas, {
      userId: 1,
      can: { approvePinnedRule: false },
    });
    expect(ideas[0].can).toEqual({
      approve: false,
      reject: false,
      withdraw: false,
      askForChange: false,
    });
  });
});
