import { ForbiddenException } from '@nestjs/common';
import axios from 'axios';
import {
  DebriefPmConversationService,
  PM_CONVERSATION_ADVISOR_THREAD,
  PM_CONVERSATION_THREAD,
  QUOTE_CHECK_REPLY,
} from '../service/debrief-pm-conversation.service';
import { debriefCan } from '../util/debrief-console-roles.util';
import {
  conversationAccess,
  isExplicitYes,
  pmReplyUnmatched,
  requiredAction,
  textLeaves,
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

jest.mock('axios');
const post = axios.post as jest.Mock;
beforeEach(() => post.mockReset());

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
  /** The pause the thread waits on (an agent message's `plan`). */
  paused?: Record<string, any> | null;
  /** ally-ai's answers, in order. */
  replies?: Array<Record<string, any>>;
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
      if (sql.includes(`SELECT id, change, evidence FROM agent_lessons`)) {
        return Object.values(ideas);
      }
      return [];
    }),
  };
  const messages = {
    findOne: jest.fn(async () => ({ ...person, actions: actions() })),
    createQueryBuilder: jest.fn(() =>
      qb(
        {
          one: opts.paused
            ? { id: 'agent-msg', who: 'agent', plan: opts.paused }
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
    reject: jest.fn(async () => undefined),
    audit: jest.fn(async () => undefined),
    writeEvidence: jest.fn(async () => undefined),
    screen: jest.fn(async () => ({ status: 'running' })),
    learningBudgetThisMonth: jest.fn(async () => 50),
    learningSpentThisMonth: jest.fn(async () => 0),
  };
  for (const r of opts.replies ?? []) post.mockResolvedValueOnce({ data: r });
  const tokens = {
    signAgent: jest.fn(() => 'tok'),
    gatewayUrl: jest.fn(() => 'http://be/gw'),
  };
  const config = { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } };
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
    config as any,
    tokens as any,
    pm as any,
    holds as any,
    view as any,
    ownerSettings as any,
    releases as any,
    {} as any,
    changes as any,
    notifier as any,
  );
  function actions() {
    return queries
      .filter(([sql]) => sql.includes('SET actions = actions ||'))
      .map(([, p]) => JSON.parse(p[1]));
  }
  /** Pauses resolved: [agent message id, decision]. */
  const usedPlans = () =>
    queries
      .filter(([sql]) => sql.includes(`jsonb_build_object('usedAt'`))
      .map(([, p]) => p);
  const posts = () => post.mock.calls.map((c) => c[1]);
  const signed = () => tokens.signAgent.mock.calls as any[];
  const saved = () => messages.save.mock.calls.map((c: any[]) => c[0]);
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
    usedPlans,
    posts,
    signed,
    saved,
  };
}

const CLAIMS = {
  kind: 'agent' as const,
  agent: 'pm_agent' as const,
  agentRunId: TURN,
  tools: [],
  exp: 0,
};

describe('Debrief PM agent conversation: rules', () => {
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

describe('Debrief PM agent conversation: who may read and post', () => {
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

describe('Debrief PM agent conversation: approvals pause for a yes, from someone allowed', () => {
  const approved = (tool: string, ideaId: string) => ({
    ...CLAIMS,
    approved: [{ tool, ideaId }],
  });

  it('approving without the person’s yes in the token does nothing', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Approve it' },
      perms: { 9: ADVISOR },
    });
    const out = await t.svc.callTool('change_approve', CLAIMS, {
      idea_id: PINNED,
      plan: 'Approve it.',
    });
    expect(out.refused).toMatch(/waits for the person’s yes/);
    // A yes to one change never carries out another.
    const other = await t.svc.callTool(
      'change_approve',
      approved('change_approve', PROMPT),
      { idea_id: PINNED },
    );
    expect(other.refused).toMatch(/waits for the person’s yes/);
  });

  it('a resumed approval carries it out as the person who said yes', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Yes, go ahead.' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool(
      'change_approve',
      approved('change_approve', PROMPT),
      { idea_id: PROMPT, plan: 'Approve it.' },
    );
    expect(out).toMatchObject({ ok: true });
    expect(t.pm.approve).toHaveBeenCalledWith(
      PROMPT,
      1,
      expect.stringContaining('Yes, go ahead.'),
    );
    expect(t.actions().pop()).toMatchObject({ status: 'done', ideaId: PROMPT });
    // The person's words are on the change.
    expect(
      t.queries.some(
        ([sql, p]) =>
          sql.includes('{conversation}') && p[1].includes('Yes, go ahead.'),
      ),
    ).toBe(true);
  });

  it('a pinned rule is never decided here: it is changed in the Skills Store by a pinned editor', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Yes, go ahead.' },
      perms: { 9: ADVISOR },
    });
    const out = await t.svc.callTool(
      'change_approve',
      approved('change_approve', PINNED),
      { idea_id: PINNED },
    );
    expect(out.refused).toMatch(
      /changed in the Skills Store by a pinned editor/,
    );
    expect(t.pm.approve).not.toHaveBeenCalled();
    expect(t.pm.reject).not.toHaveBeenCalled();
  });

  it('a turn-down needs a reason the Debrief PM agent reads', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'yes' },
      perms: { 1: TEAM },
    });
    const out = await t.svc.callTool(
      'change_turn_down',
      approved('change_turn_down', PROMPT),
      { idea_id: PROMPT },
    );
    expect(out.refused).toMatch(/say why/);
    expect(t.pm.reject).not.toHaveBeenCalled();
    await t.svc.callTool(
      'change_turn_down',
      approved('change_turn_down', PROMPT),
      { idea_id: PROMPT, reason: 'Too long for Tamil learners' },
    );
    expect(t.pm.reject).toHaveBeenCalledWith(
      PROMPT,
      1,
      'Too long for Tamil learners',
    );
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

describe('Debrief PM agent conversation: a turn, paused and resumed (ally-ai human-in-the-loop)', () => {
  const pending = (tool = 'change_approve', ideaId = PINNED, extra = {}) => ({
    interrupt_id: 'int-1',
    actions: [
      {
        tool,
        args: {
          idea_id: ideaId,
          plan: 'Approve the Safety rules change.',
          ...extra,
        },
        plan: 'Approve the Safety rules change.',
      },
    ],
  });
  const reply = (over: Record<string, any> = {}) => ({
    status: 'finished',
    reply:
      'Approve the Safety rules change. Shall I go ahead? Reply yes to confirm.',
    pending: null,
    tool_texts: [],
    estimated_cost_usd: 0.01,
    model: 'gemini-2.5-pro',
    ...over,
  });
  const paused = (over: Record<string, any> = {}) => ({
    id: 'int-1',
    threadId: PM_CONVERSATION_THREAD,
    actions: [
      {
        tool: 'change_approve',
        ideaId: PINNED,
        args: {},
        label: 'Approve “Safety rules: name the moment”',
      },
    ],
    text: 'Approve the Safety rules change.',
    label: 'Approve “Safety rules: name the moment”',
    askedUserId: 9,
    at: new Date().toISOString(),
    usedAt: null,
    ...over,
  });

  it('the advisor asks: the pause is kept with the plan, nothing acted, on the advisor’s own thread', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Approve it' },
      perms: { 9: ADVISOR },
      replies: [reply({ pending: pending() })],
    });
    const { messages } = await t.svc.post(viewer(9, ADVISOR), {
      text: 'Approve it',
      about: { kind: 'change', id: PINNED, label: 'Safety' },
    });
    const body = t.posts()[0];
    expect(body.thread_id).toBe(PM_CONVERSATION_ADVISOR_THREAD);
    expect(body.resume).toBeNull();
    expect(body).not.toHaveProperty('history');
    expect(body.tools).not.toContain('confirm_plan');
    expect(messages[1].action).toEqual({
      label: 'Waiting for your yes: approve “Safety rules: name the moment”',
      status: 'awaiting_yes',
    });
    const saved = t.saved().find((m) => m.who === 'agent');
    expect(saved.plan).toMatchObject({
      id: 'int-1',
      threadId: PM_CONVERSATION_ADVISOR_THREAD,
      askedUserId: 9,
      actions: [{ tool: 'change_approve', ideaId: PINNED }],
    });
  });

  it('the same allowed person’s clear yes resumes with approve and a token for them', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Yes, go ahead.' },
      perms: { 9: ADVISOR },
      paused: paused({ threadId: PM_CONVERSATION_ADVISOR_THREAD }),
      replies: [reply({ reply: 'Approved the Safety rules change.' })],
    });
    await t.svc.post(viewer(9, ADVISOR), {
      text: 'Yes, go ahead.',
      about: { kind: 'change', id: PINNED, label: 'Safety' },
    });
    const body = t.posts()[0];
    expect(body.resume).toEqual({ interrupt_id: 'int-1', decision: 'approve' });
    expect(t.signed()[0]).toEqual([
      'saved', // the person's new message (the turn id)
      expect.any(Array),
      900,
      [{ tool: 'change_approve', ideaId: PINNED }],
    ]);
    expect(t.usedPlans()).toEqual([['agent-msg', 'approve']]);
  });

  it.each([
    [
      'anything but a clear yes',
      9,
      'yes but only for Hindi',
      /did not say yes/,
    ],
    [
      'someone other than the person asked',
      7,
      'yes',
      /only the person who was asked/,
    ],
  ])(
    '%s resumes with reject, with their words, and nothing is carried out',
    async (_label, userId, text, why) => {
      const t = build({
        person: { authorUserId: userId, text },
        perms: { 9: ADVISOR, 7: OWNER },
        paused: paused(),
        replies: [reply({ reply: 'Nothing was done.' })],
      });
      await t.svc.post(viewer(userId, userId === 9 ? ADVISOR : OWNER), {
        text,
        about: { kind: 'change', id: PINNED, label: 'Safety' },
      });
      const { resume } = t.posts()[0];
      expect(resume).toMatchObject({
        interrupt_id: 'int-1',
        decision: 'reject',
      });
      expect(resume.message).toMatch(why);
      expect(resume.message).toContain(text);
      expect(t.signed()[0][3]).toEqual([]);
      expect(t.usedPlans()).toEqual([['agent-msg', 'reject']]);
    },
  );

  it('a lapsed pause is turned down', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'yes' },
      perms: { 9: ADVISOR },
      paused: paused({
        at: new Date(Date.now() - 25 * 3600_000).toISOString(),
      }),
      replies: [reply({ reply: 'That lapsed.' })],
    });
    await t.svc.post(viewer(9, ADVISOR), {
      text: 'yes',
      about: { kind: 'change', id: PINNED, label: 'Safety' },
    });
    expect(t.posts()[0].resume.message).toMatch(/lapsed/);
  });

  it('a yes from someone who lost the permission is turned down and the deciders asked', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'yes' },
      perms: { 1: TEAM },
      paused: paused({ askedUserId: 1 }),
      replies: [
        reply({ reply: 'Only the clinical advisor or the owner can.' }),
      ],
    });
    await t.svc.post(viewer(1, TEAM), { text: 'yes' });
    const { resume } = t.posts()[0];
    expect(resume.decision).toBe('reject');
    expect(resume.message).toMatch(/clinical advisor or the owner/);
    expect(t.notifier.pinnedRuleDeciders).toHaveBeenCalled();
  });

  it('a pause the person could never say yes to is turned down in the same turn', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'Approve the safety change' },
      perms: { 1: TEAM },
      replies: [
        reply({ pending: pending(), estimated_cost_usd: 0.02 }),
        reply({
          reply:
            "Only the clinical advisor or the owner can approve this; I've asked them.",
          estimated_cost_usd: 0.01,
        }),
      ],
    });
    const { messages } = await t.svc.post(viewer(1, TEAM), {
      text: 'Approve the safety change',
    });
    const [, second] = t.posts();
    expect(second.resume).toMatchObject({
      interrupt_id: 'int-1',
      decision: 'reject',
    });
    expect(second.resume.message).toMatch(/clinical advisor or the owner/);
    expect(t.notifier.pinnedRuleDeciders).toHaveBeenCalled();
    expect(messages[1].action).toMatchObject({ status: 'failed' });
    const saved = t.saved().find((m) => m.who === 'agent');
    expect(saved.plan).toBeNull();
    expect(saved.costUsd).toBe('0.03');
  });

  it('an always-ask retry pauses in ally-ai; the gateway refuses one without a yes', async () => {
    const id = '66666666-6666-6666-6666-666666666666';
    ideas[id] = {
      ...ideas[PROMPT],
      id,
      status: 'rejected',
      evidence: { ...ideas[PROMPT].evidence, stopped: { at: 'x' } },
    };
    const t = build({
      person: { authorUserId: 1, text: 'Try it again' },
      perms: { 1: TEAM },
      replies: [reply({ pending: pending('change_retry', id) })],
    });
    await t.svc.post(viewer(1, TEAM), { text: 'Try it again' });
    expect(t.posts()[0].always_ask_idea_ids).toContain(id);
    const saved = t.saved().find((m) => m.who === 'agent');
    expect(saved.plan.actions[0]).toMatchObject({
      tool: 'change_retry',
      ideaId: id,
    });
    const out = await t.svc.callTool('change_retry', CLAIMS, { idea_id: id });
    expect(out.refused).toMatch(/waits for their yes/);
    expect(t.pm.screen).not.toHaveBeenCalled();
    await t.svc.callTool(
      'change_retry',
      { ...CLAIMS, approved: [{ tool: 'change_retry', ideaId: id }] },
      { idea_id: id },
    );
    expect(t.pm.screen).toHaveBeenCalledWith(id);
  });
});

describe('Debrief PM agent conversation: the quote check', () => {
  const RULE = 'Name the moment the learner noticed risk, in their own words.';

  it('a reply quoting text no tool returned is not shown, and kept for the Ally team', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'What does the rule say?' },
      perms: { 1: TEAM },
      replies: [
        {
          status: 'finished',
          reply:
            'The new rule reads: “Always ask the learner how they felt first.”',
          tool_texts: [RULE],
        },
      ],
    });
    const { messages } = await t.svc.post(viewer(1, TEAM), {
      text: 'What does the rule say?',
    });
    expect(messages[1].text).toBe(QUOTE_CHECK_REPLY);
    expect(t.pm.audit).toHaveBeenCalledWith(
      'blocked',
      null,
      1,
      expect.objectContaining({
        step: 'conversation_quote_check',
        withheldReply: expect.stringContaining('Always ask the learner'),
      }),
    );
  });

  it('a reply quoting what change_read returned is shown', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'What does the rule say?' },
      perms: { 1: TEAM },
      replies: [
        {
          status: 'finished',
          reply: `The rule says: “${RULE}”`,
          tool_texts: ['Safety rules', RULE],
        },
      ],
    });
    const { messages } = await t.svc.post(viewer(1, TEAM), {
      text: 'What does the rule say?',
    });
    expect(messages[1].text).toContain(RULE);
  });

  it('a pause whose reply fails the check is not kept', async () => {
    const t = build({
      person: { authorUserId: 9, text: 'Approve it' },
      perms: { 9: ADVISOR },
      replies: [
        {
          status: 'finished',
          reply:
            'Wording: "Learners must always be told they did well first." Reply yes.',
          pending: {
            interrupt_id: 'int-1',
            actions: [
              { tool: 'change_approve', args: { idea_id: PINNED }, plan: 'x' },
            ],
          },
          tool_texts: [],
        },
      ],
    });
    const { messages } = await t.svc.post(viewer(9, ADVISOR), {
      text: 'Approve it',
      about: { kind: 'change', id: PINNED, label: 'Safety' },
    });
    expect(messages[1].text).toBe(QUOTE_CHECK_REPLY);
    expect(t.saved().find((m) => m.who === 'agent').plan).toBeNull();
  });

  it('checks quotes and presented wording, not summaries', () => {
    const src = ['Keep each card under 40 words for Tamil learners.'];
    expect(
      pmReplyUnmatched('It shortens the Tamil cards (n=40).', src),
    ).toEqual([]);
    expect(
      pmReplyUnmatched(
        'After: “Keep each card under 40 words for Tamil learners.”',
        src,
      ),
    ).toEqual([]);
    expect(
      pmReplyUnmatched('After: Keep each card under 30 words for Tamil.', src),
    ).toEqual(['Keep each card under 30 words for Tamil.']);
    expect(
      pmReplyUnmatched('> Cards must open with praise for the learner', src),
    ).toEqual(['Cards must open with praise for the learner']);
    expect(textLeaves({ a: ['x', { b: 'y' }], c: 3 })).toEqual(['x', 'y']);
  });
});

describe('Debrief PM agent conversation: actions that act at once', () => {
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

  it('a turn token that names no person message acts on nothing; a run reads one change', async () => {
    const t = build({
      person: { authorUserId: 1, text: 'x' },
      perms: { 1: TEAM },
    });
    (t.svc as any).messages.findOne = jest.fn(async () => null);
    const out = await t.svc.callTool('change_undo', CLAIMS, { idea_id: LIVE });
    expect(out.refused).toMatch(/not known/);
    // A weekly run's reviewer reads the change it reviews.
    const read = await t.svc.callTool('change_read', CLAIMS, {
      idea_id: PINNED,
    });
    expect(read).toMatchObject({
      id: PINNED,
      title: 'Safety rules: name the moment',
    });
  });
});
