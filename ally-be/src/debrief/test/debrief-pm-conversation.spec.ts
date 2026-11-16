import { ForbiddenException } from '@nestjs/common';
import { DebriefPmConversationService } from '../service/debrief-pm-conversation.service';
import { debriefCan } from '../util/debrief-console-roles.util';
import {
  conversationAccess,
  isExplicitYes,
  requiredAction,
  toPmMessage,
} from '../util/debrief-pm-conversation.util';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

const TEAM = [PERMISSIONS.SYSTEM_ACCESS];
const ADVISOR = [PERMISSIONS.REVIEW_DEBRIEFS];
const OWNER = [PERMISSIONS.MANAGE_DEBRIEF_SETTINGS];
const PINNED = '11111111-1111-1111-1111-111111111111';
const PROMPT = '22222222-2222-2222-2222-222222222222';
const BUDGET = '33333333-3333-3333-3333-333333333333';
const LIVE = '44444444-4444-4444-4444-444444444444';
const TURN = '55555555-5555-5555-5555-555555555555';

const viewer = (userId: number, perms: string[]) => ({
  userId,
  roles: {} as any,
  can: debriefCan(perms),
});

const ideas: Record<string, Record<string, any>> = {
  [PINNED]: {
    id: PINNED,
    text: 'Safety rules: name the moment',
    status: 'proposed',
    change: {
      ideaKind: 'pinned_rule',
      promptCode: 'debrief_safety_reader_system',
    },
    evidence: {},
  },
  [PROMPT]: {
    id: PROMPT,
    text: 'Shorter Tamil cards',
    status: 'proposed',
    change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
    evidence: { confidence: { level: 'low', why: 'n=12' } },
  },
  [BUDGET]: {
    id: BUDGET,
    text: 'Raise the run ceiling',
    status: 'proposed',
    change: { ideaKind: 'release', budgetOnly: true },
    evidence: {},
  },
  [LIVE]: {
    id: LIVE,
    text: 'Warmer openings',
    status: 'active',
    releaseId: 'rel-new',
    change: { ideaKind: 'prompt_edit', promptCode: 'debrief_writer_system' },
    evidence: {},
  },
};

/** A chainable stand-in for TypeORM's query builder, answering `getOne` / `getMany`. */
function qb(result: { one?: any; many?: any[] }, calls: string[]) {
  const b: any = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'take']) {
    b[m] = jest.fn((sql: string) => {
      if (typeof sql === 'string') calls.push(sql);
      return b;
    });
  }
  b.getOne = jest.fn(async () => result.one ?? null);
  b.getMany = jest.fn(async () => result.many ?? []);
  return b;
}

function build(opts: {
  person: {
    id?: string;
    authorUserId: number;
    text: string;
    authorName?: string;
  };
  perms: Record<number, string[]>;
  pendingPlan?: Record<string, any> | null;
}) {
  const person = {
    id: opts.person.id ?? TURN,
    who: 'person',
    authorName: opts.person.authorName ?? 'Asha',
    createdAt: new Date(),
    actions: [],
    ...opts.person,
  };
  const queries: Array<[string, any[]]> = [];
  const qbCalls: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      queries.push([sql, params]);
      if (sql.includes('FROM agent_release_audit')) return [{ id: 'rel-old' }];
      if (sql.includes(`SELECT id, change FROM agent_lessons`)) {
        return Object.values(ideas).map((i) => ({
          id: i.id,
          change: i.change,
        }));
      }
      return [];
    }),
  };
  const messages = {
    findOne: jest.fn(async () => person),
    createQueryBuilder: jest.fn(() =>
      qb(
        {
          one: opts.pendingPlan
            ? { id: 'agent-msg', who: 'agent', plan: opts.pendingPlan }
            : null,
          many: [],
        },
        qbCalls,
      ),
    ),
    save: jest.fn(async (m: any) => ({
      id: 'saved',
      createdAt: new Date(),
      ...m,
    })),
    create: jest.fn((m: any) => m),
  };
  const pm = {
    getIdea: jest.fn(async (id: string) => ideas[id]),
    approve: jest.fn(async () => ({ stage: 'canary' })),
    approvePinnedRule: jest.fn(async () => ({ releaseId: 'r' })),
    reject: jest.fn(async () => undefined),
    rejectPinnedRule: jest.fn(async () => undefined),
    audit: jest.fn(async () => undefined),
    writeEvidence: jest.fn(async () => undefined),
    screen: jest.fn(async () => ({ status: 'running' })),
  };
  const holds = {
    languagesFor: jest.fn(async () => ({ languages: null, heldLanguages: [] })),
    pin: jest.fn(async () => ({})),
    lift: jest.fn(async () => []),
    pause: jest.fn(async () => ({})),
  };
  const view = {
    viewer: jest.fn(async (id: number) => viewer(id, opts.perms[id] ?? [])),
  };
  const ownerSettings = {
    get: jest.fn(async () => ({
      pmAgentRunCapUsd: 2,
      askLowConfidence: true,
      askModels: false,
    })),
  };
  const releases = {
    getGa: jest.fn(async () => ({ id: 'rel-new' })),
    makeGa: jest.fn(async () => ({ id: 'rel-old', version: 4 })),
    stopCanary: jest.fn(async () => ({})),
  };
  const changes = {
    undo: jest.fn(async () => ({})),
    stop: jest.fn(async () => ({})),
  };
  const notifier = {
    pinnedRuleDeciders: jest.fn(async () => 2),
    owner: jest.fn(async () => 1),
  };
  const svc = new DebriefPmConversationService(
    dataSource as any,
    messages as any,
    {} as any,
    {} as any,
    pm as any,
    holds as any,
    view as any,
    ownerSettings as any,
    releases as any,
    {} as any,
    changes as any,
    notifier as any,
  );
  const actions = () =>
    queries
      .filter(([sql]) => sql.includes('SET actions = actions ||'))
      .map(([, p]) => JSON.parse(p[1]));
  const planWrites = () =>
    queries.filter(([sql]) => sql.includes('SET plan = $2::jsonb'));
  return {
    svc,
    pm,
    holds,
    releases,
    changes,
    notifier,
    queries,
    qbCalls,
    actions,
    planWrites,
  };
}

const CLAIMS = {
  kind: 'agent' as const,
  agent: 'pm_agent' as const,
  agentRunId: TURN,
  tools: [],
  exp: 0,
};

describe('PM agent conversation: rules', () => {
  it('only a clear yes counts', () => {
    for (const yes of [
      'yes',
      'Yes, go ahead.',
      'ok do it',
      'haan',
      'हाँ',
      'Confirmed!',
    ]) {
      expect(isExplicitYes(yes)).toBe(true);
    }
    for (const no of [
      'yes but only for Hindi',
      'no',
      'why?',
      'not yet, yes later',
      '',
    ]) {
      expect(isExplicitYes(no)).toBe(false);
    }
  });

  it('keeps today’s permissions', () => {
    expect(requiredAction(ideas[PINNED], true)).toBe('approvePinnedRule');
    expect(requiredAction(ideas[BUDGET], true)).toBe('ownerSettings');
    expect(requiredAction(ideas[PROMPT], true)).toBe('pmAgent');
    expect(conversationAccess(debriefCan(TEAM))).toBe('all');
    expect(conversationAccess(debriefCan(OWNER))).toBe('all');
    expect(conversationAccess(debriefCan(ADVISOR))).toBe('pinned_rules');
    expect(conversationAccess(debriefCan([]))).toBe('none');
  });

  it('every message names its author', () => {
    const m = toPmMessage({
      id: 'm1',
      who: 'person',
      authorName: 'Asha',
      text: 'hi',
      createdAt: new Date('2026-11-16T10:00:00Z'),
      about: { kind: 'change', id: PINNED, label: 'Safety' },
      action: null,
    } as any);
    expect(m).toEqual({
      id: 'm1',
      at: '2026-11-16T10:00:00.000Z',
      who: 'person',
      author: 'Asha',
      text: 'hi',
      about: { kind: 'change', id: PINNED, label: 'Safety' },
      action: null,
    });
  });
});

describe('PM agent conversation: who may read and post', () => {
  it('the clinical advisor posts only about a pinned-rule change', async () => {
    const { svc } = build({
      person: { authorUserId: 9, text: 'hi' },
      perms: { 9: ADVISOR },
    });
    await expect(
      svc.post(viewer(9, ADVISOR), {
        text: 'What about Tamil?',
        about: { kind: 'change', id: PROMPT, label: 'Tamil' },
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      svc.post(viewer(9, ADVISOR), { text: 'What changed?' }),
    ).rejects.toThrow(/pinned-rule changes only/);
  });

  it('the clinical advisor reads only messages about pinned-rule changes', async () => {
    const { svc, qbCalls } = build({
      person: { authorUserId: 9, text: 'hi' },
      perms: { 9: ADVISOR },
    });
    await svc.list(viewer(9, ADVISOR), {});
    expect(qbCalls).toContain(`m.about->>'id' IN (:...ids)`);
    const team = build({ person: { authorUserId: 1, text: 'hi' }, perms: {} });
    await team.svc.list(viewer(1, TEAM), { about: PINNED });
    expect(team.qbCalls).toContain(`m.about->>'id' = :about`);
    expect(team.qbCalls).not.toContain(`m.about->>'id' IN (:...ids)`);
  });

  it('someone without the console permissions cannot read it', async () => {
    const { svc } = build({
      person: { authorUserId: 3, text: 'x' },
      perms: {},
    });
    await expect(svc.list(viewer(3, []), {})).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('PM agent conversation: approvals wait for a yes, from someone allowed', () => {
  it('a team member asking to approve a pinned rule: not acted on; the advisor and owner are asked', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Approve the safety change' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool('change_approve', CLAIMS, {
      idea_id: PINNED,
      plan: 'Approve it.',
    });
    expect(out.refused).toBe(
      "Only the clinical advisor or the owner can approve this; I've asked them.",
    );
    expect(t.notifier.pinnedRuleDeciders).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: `/debriefs?change=${PINNED}` }),
      }),
    );
    expect(t.planWrites()).toHaveLength(0);
    expect(t.pm.approvePinnedRule).not.toHaveBeenCalled();
    expect(t.actions().map((a) => a.status)).toEqual(['failed']);
  });

  it('a budget increase is the owner’s: the team is told so', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Approve the budget raise' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool('change_approve', CLAIMS, {
      idea_id: BUDGET,
      plan: 'Raise it.',
    });
    expect(out.refused).toMatch(/^Only the owner can approve this/);
    expect(t.notifier.owner).toHaveBeenCalled();
  });

  it('the advisor asks: a plan, awaiting yes; nothing acted', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Approve it' },
      perms: { 9: ADVISOR },
    });
    const out = await t.svc.callTool('change_approve', CLAIMS, {
      idea_id: PINNED,
      plan: 'Approve the Safety rules change; a draft release is made.',
    });
    expect(out).toMatchObject({ status: 'awaiting_yes' });
    expect(t.planWrites()).toHaveLength(1);
    expect(t.actions()[0]).toMatchObject({
      status: 'awaiting_yes',
      ideaId: PINNED,
    });
    expect(t.pm.approvePinnedRule).not.toHaveBeenCalled();
  });

  const plan = (over: Record<string, any> = {}) => ({
    id: 'plan-1',
    tool: 'change_approve',
    ideaId: PINNED,
    args: {},
    text: 'Approve it.',
    label: 'Approve “Safety rules: name the moment”',
    askedUserId: 9,
    at: new Date().toISOString(),
    usedAt: null,
    ...over,
  });

  it('a later yes from the same, allowed person carries it out as them', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Yes, go ahead.' },
      perms: { 9: ADVISOR },
      pendingPlan: plan(),
    });
    const out = await t.svc.callTool('confirm_plan', CLAIMS, {
      plan_id: 'plan-1',
    });
    expect(out).toMatchObject({ ok: true });
    expect(t.pm.approvePinnedRule).toHaveBeenCalledWith(
      PINNED,
      9,
      expect.stringContaining('Yes, go ahead.'),
    );
    expect(t.actions().pop()).toMatchObject({
      status: 'done',
      planId: 'plan-1',
    });
    // The person's words are on the change.
    expect(
      t.queries.some(
        ([sql, p]) =>
          sql.includes('{conversation}') && p[1].includes('Yes, go ahead.'),
      ),
    ).toBe(true);
  });

  it('anything but a clear yes does nothing', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'yes but only for Hindi' },
      perms: { 9: ADVISOR },
      pendingPlan: plan(),
    });
    const out = await t.svc.callTool('confirm_plan', CLAIMS, {
      plan_id: 'plan-1',
    });
    expect(out.refused).toMatch(/did not say a clear yes/);
    expect(t.pm.approvePinnedRule).not.toHaveBeenCalled();
  });

  it('only the person who was asked can say yes', async () => {
    const t = build({
      person: { authorUserId: 7, text: 'yes' },
      perms: { 7: OWNER },
      pendingPlan: plan(),
    });
    const out = await t.svc.callTool('confirm_plan', CLAIMS, {
      plan_id: 'plan-1',
    });
    expect(out.refused).toMatch(/only the person who was asked/);
    expect(t.pm.approvePinnedRule).not.toHaveBeenCalled();
  });

  it('a yes from someone who lost the permission is refused and the deciders asked', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'yes' },
      perms: { 1: TEAM },
      pendingPlan: plan({ askedUserId: 1 }),
    });
    const out = await t.svc.callTool('confirm_plan', CLAIMS, {
      plan_id: 'plan-1',
    });
    expect(out.refused).toMatch(/clinical advisor or the owner/);
    expect(t.notifier.pinnedRuleDeciders).toHaveBeenCalled();
    expect(t.pm.approvePinnedRule).not.toHaveBeenCalled();
  });

  it('the advisor cannot stop, undo or pause anything', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Undo it' },
      perms: { 9: ADVISOR },
    });
    const out = await t.svc.callTool('change_undo', CLAIMS, { idea_id: LIVE });
    expect(out.refused).toMatch(/pinned-rule changes only/);
    expect(t.releases.makeGa).not.toHaveBeenCalled();
  });
});

describe('PM agent conversation: actions that act at once', () => {
  it('undo for everyone is the console’s Undo now', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Undo the warmer openings' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool('change_undo', CLAIMS, { idea_id: LIVE });
    expect(out).toMatchObject({ ok: true });
    // The console's Undo now, as the person who asked.
    expect(t.changes.undo).toHaveBeenCalledWith(LIVE, 1, null);
    expect(t.actions().pop()).toMatchObject({ status: 'done', ideaId: LIVE });
  });

  it('undo for one language pins it to the release before (A9)', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Undo it for Hindi' },
      perms: { 1: TEAM },
    });
    await t.svc.callTool('change_undo', CLAIMS, {
      idea_id: LIVE,
      languages: ['hi'],
    });
    expect(t.holds.pin).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'hi',
        releaseId: 'rel-old',
        reason: 'undone',
      }),
    );
    expect(t.releases.makeGa).not.toHaveBeenCalled();
  });

  it('a retry of a change that always asks waits for a yes', async () => {
    const stopped = {
      ...ideas[PROMPT],
      status: 'rejected',
      evidence: { ...ideas[PROMPT].evidence, stopped: { at: 'x' } },
    };
    ideas['66666666-6666-6666-6666-666666666666'] = {
      ...stopped,
      id: '66666666-6666-6666-6666-666666666666',
    };
    const t = build({
      person: { authorUserId: 1, text: 'Try it again' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool('change_retry', CLAIMS, {
      idea_id: '66666666-6666-6666-6666-666666666666',
    });
    expect(out).toMatchObject({ status: 'awaiting_yes' });
    expect(t.pm.screen).not.toHaveBeenCalled();
  });

  it('stop is the console’s Stop now', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Stop the Tamil change' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool('change_stop', CLAIMS, {
      idea_id: PROMPT,
      reason: 'Tamil learners are confused',
    });
    expect(out).toMatchObject({ ok: true });
    expect(t.changes.stop).toHaveBeenCalledWith(
      PROMPT,
      1,
      'Tamil learners are confused',
    );
  });

  it('a turn token that names no person message acts on nothing', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'x' },
      perms: { 1: TEAM },
    });
    (t.svc as any).messages.findOne = jest.fn(async () => null);
    const out = await t.svc.callTool('change_undo', CLAIMS, { idea_id: LIVE });
    expect(out.refused).toMatch(/not known/);
  });
});
