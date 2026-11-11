import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DebriefGatewayController } from '../controller/debrief-gateway.controller';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefGatewayService } from '../service/debrief-gateway.service';
import {
  ASK_ALLY_GATEWAY_TOOLS,
  DEBRIEF_GATEWAY_TOOLS,
  DebriefRunTokenService,
} from '../service/debrief-run-token.service';
import {
  ADVISORY_CHECKS,
  checkWeight,
  DebriefCards,
  keepOfferedPractice,
  renderCards,
  runDebriefChecks,
  withPointIds,
} from '../util/debrief-cards.util';

const transcript = [
  { turn_index: 1, role: 'counselor', text: 'What brings you here today?' },
  { turn_index: 2, role: 'client', text: 'I cannot sleep before exams.' },
];

const cards: DebriefCards = {
  opening: 'You helped the client open up.',
  important_moment: null,
  what_worked: [
    {
      skill: 'open questions',
      turn_index: 1,
      quote: 'What brings you here today?',
      lead: 'Your opening let the client lead.',
      body: 'It invited them to start anywhere.',
    },
  ],
  work_on_this: [],
  practise_next: { skill: 'reflections', scenario_id: 41 } as any,
} as unknown as DebriefCards;

function build(
  opts: {
    run?: Record<string, unknown> | null;
    secret?: string;
    guidance?: unknown[] | Error;
  } = {},
) {
  const run =
    opts.run === null
      ? null
      : {
          id: 'run-1',
          scenarioSessionId: 's1',
          tenantId: '6b0d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e6f',
          status: DebriefRunStatus.RUNNING,
          mode: DebriefRunMode.LIVE,
          ...(opts.run ?? {}),
        };
  const runs = {
    findOne: jest.fn(async () => run),
    query: jest.fn(async () => []),
  };
  const config = {
    debriefGatewaySecret: opts.secret ?? 'gateway-secret',
    jwt: { accessToken: { secret: 'access-secret' } },
  };
  const context = {
    transcript: jest.fn(async () => transcript),
    loadSession: jest.fn(async () => ({
      tenantId: 't-from-session',
      scenarioId: 41,
    })),
    pastWorkOnThis: jest.fn(async () => [
      { date: '2026-10-20', skill: 'Exploring risk', point: 'Ask directly' },
    ]),
    liveDetections: jest.fn(async () => [
      { behaviour: 'Asks about safety', detected: true, times: 2 },
    ]),
  };
  const retrieval = {
    search: jest.fn(async () => {
      if (opts.guidance instanceof Error) throw opts.guidance;
      const results = opts.guidance ?? [];
      return { results, noConfidentMatch: results.length === 0 };
    }),
  };
  const tokens = new DebriefRunTokenService(config as any, runs as any);
  const gateway = new DebriefGatewayService(
    runs as any,
    context as any,
    retrieval as any,
  );
  const controller = new DebriefGatewayController(tokens, gateway);
  const bearer = (t = tokens.sign('run-1', 's1')) => `Bearer ${t}`;
  return { tokens, controller, runs, context, retrieval, bearer };
}

describe('DebriefRunTokenService', () => {
  it('signs a 15-minute HS256 token with the run, session and tools', () => {
    const { tokens } = build();
    const token = tokens.sign('run-1', 's1');
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString(),
    );
    expect(header.alg).toBe('HS256');
    const claims = tokens.verify(token);
    expect(claims).toMatchObject({
      runId: 'run-1',
      sessionId: 's1',
      tools: [...DEBRIEF_GATEWAY_TOOLS],
    });
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(890);
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(900);
  });

  it('refuses an expired token', () => {
    const { tokens } = build();
    const expired = jwt.sign(
      {
        runId: 'run-1',
        sessionId: 's1',
        tools: ['progress'],
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      'gateway-secret',
      { algorithm: 'HS256' },
    );
    expect(() => tokens.verify(expired)).toThrow('Run token expired');
  });

  it('refuses a token signed with another secret, such as a user JWT', () => {
    const { tokens } = build();
    const userJwt = jwt.sign({ sub: 7 }, 'access-secret');
    expect(() => tokens.verify(userJwt)).toThrow(UnauthorizedException);
    const forged = jwt.sign(
      { runId: 'run-1', sessionId: 's1', tools: ['progress'] },
      'access-secret',
    );
    expect(() => tokens.verify(forged)).toThrow(UnauthorizedException);
  });

  it('derives its secret from the access secret when none is set, never using the access secret itself', () => {
    const { tokens } = build({ secret: '' });
    const token = tokens.sign('run-1', 's1');
    expect(tokens.verify(token).runId).toBe('run-1');
    expect(() => jwt.verify(token, 'access-secret')).toThrow();
  });

  it('refuses a tool the token does not allow', async () => {
    const { tokens, bearer } = build();
    await expect(
      tokens.authorise(
        bearer(tokens.sign('run-1', 's1', ['progress'])),
        'run_checks',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['finished', { status: DebriefRunStatus.PUBLISHED }],
    ['for another session', { scenarioSessionId: 's2' }],
  ])('refuses a run that is %s', async (_label, run) => {
    const { tokens, bearer } = build({ run });
    await expect(tokens.authorise(bearer(), 'progress')).rejects.toThrow(
      'The run is not running',
    );
  });

  it('refuses a run that does not exist, and a missing token', async () => {
    const { tokens, bearer } = build({ run: null });
    await expect(tokens.authorise(bearer(), 'progress')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(tokens.authorise(undefined, 'progress')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('DebriefGatewayController', () => {
  it('refuses an unknown tool', async () => {
    const { controller, bearer } = build();
    await expect(controller.tool('drop_tables', bearer(), {})).rejects.toThrow(
      'No debrief tool drop_tables',
    );
  });

  it('guidance_search: Debrief Guidance per moment, as the run’s organisation may read it', async () => {
    const chunk = {
      id: 'c1',
      code: 'DG-0001',
      statement: 'Ask about safety directly.',
      body: 'Ask plainly whether the person is thinking of ending their life.',
      citation: { title: 'Risk guide' },
    };
    const { controller, bearer, retrieval } = build({
      guidance: [{ chunk, band: 'good', score: 0.9 }],
    });
    const res = await controller.tool('guidance_search', bearer(), {
      topics: [
        { skill: 'exploring risk', situation: 'client hints at hopelessness' },
        { skill: 'exploring risk', situation: 'client says no point' },
        { skill: 'a', situation: 'b' },
        { skill: 'c', situation: 'never searched: over the cap of three' },
      ],
      per_moment: 2,
    });
    expect(retrieval.search).toHaveBeenCalledTimes(3);
    expect((retrieval.search.mock.calls as any[][])[0][0]).toMatchObject({
      useCase: 'debrief',
      audience: { tenantId: '6b0d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e6f' },
      queries: ['client hints at hopelessness'],
      limit: 2,
      sessionId: 's1',
    });
    expect(res).toEqual({
      passages: [
        {
          id: 'c1',
          code: 'DG-0001',
          title: 'Risk guide',
          text: chunk.body,
          citation: 'Risk guide',
          band: 'good',
        },
      ],
      no_confident_match: false,
    });
  });

  it('guidance_search: nothing confident is nothing, and unreachable guidance never fails the call', async () => {
    const none = build({ guidance: [] });
    expect(
      await none.controller.tool('guidance_search', none.bearer(), {
        topics: [{ situation: 'x' }],
      }),
    ).toEqual({ passages: [], no_confident_match: true });
    const down = build({ guidance: new Error('weaviate down') });
    expect(
      await down.controller.tool('guidance_search', down.bearer(), {
        topics: [{ situation: 'x' }],
      }),
    ).toEqual({ passages: [], no_confident_match: true, unavailable: true });
  });

  it('run_checks: the rule checks on the transcript ally-be loads', async () => {
    const { controller, bearer, context } = build();
    const safety = { risk_cues: [], learner_distress: [] };
    const res: any = await controller.tool('run_checks', bearer(), {
      cards,
      safety,
      language: 'en',
      short_form: false,
      has_progress: false,
    });
    expect(context.transcript).toHaveBeenCalledWith('s1');
    const expected = runDebriefChecks({
      cards,
      transcript: transcript as any,
      safety,
      language: 'en',
      shortForm: false,
      hasProgress: false,
    });
    expect(res.failures).toEqual(expected);
    expect(res.weight).toBe(checkWeight(expected));
    expect(res.advisory).toEqual([...ADVISORY_CHECKS]);
  });

  it('render_cards and finalise_cards: the existing card functions', async () => {
    const { controller, bearer } = build();
    expect(await controller.tool('render_cards', bearer(), { cards })).toEqual({
      text: renderCards(cards),
    });
    expect(
      await controller.tool('finalise_cards', bearer(), {
        cards,
        offered: [7],
      }),
    ).toEqual({
      cards: withPointIds(keepOfferedPractice(cards, new Set([7]))),
    });
  });

  it('progress: writes the learner’s working panel while the run is running', async () => {
    const { controller, bearer, runs } = build();
    expect(
      await controller.tool('progress', bearer(), {
        step: 'writer',
        round: 1,
        topic: 'exploring risk',
        has_risk_cue: true,
      }),
    ).toEqual({ ok: true });
    const [sql, params] = (runs.query.mock.calls as any[][])[0];
    expect(sql).toMatch(/liveProgress/);
    expect(sql).toMatch(/status = 'running'/);
    expect(params[0]).toBe('run-1');
    expect(JSON.parse(params[1])).toEqual({
      step: 'writer',
      round: 1,
      topic: 'exploring risk',
    });
    expect(params[2]).toBe(true);
  });
});

describe('Ask Ally reply tokens (CONTRACT.md §5)', () => {
  const published = { status: DebriefRunStatus.PUBLISHED };

  it('signs a short token scoped to the reply, the learner and Ask Ally’s tools', () => {
    const { tokens } = build();
    const claims = tokens.verify(tokens.signReply('run-1', 's1', 7));
    expect(claims).toMatchObject({
      runId: 'run-1',
      sessionId: 's1',
      userId: 7,
      scope: 'reply',
      tools: [...ASK_ALLY_GATEWAY_TOOLS],
    });
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
  });

  it.each([DebriefRunStatus.PUBLISHED, DebriefRunStatus.BELOW_BAR])(
    'works on the learner’s %s live debrief',
    async (status) => {
      const { tokens, bearer } = build({ run: { status } });
      const { run, claims } = await tokens.authorise(
        bearer(tokens.signReply('run-1', 's1', 7)),
        'get_live_detections',
      );
      expect(run.id).toBe('run-1');
      expect(claims.userId).toBe(7);
    },
  );

  it.each([
    ['still running', { status: DebriefRunStatus.RUNNING }],
    ['a shadow run', { ...published, mode: DebriefRunMode.SHADOW }],
    ['for another session', { ...published, scenarioSessionId: 's2' }],
  ])('refuses a debrief that is %s', async (_label, run) => {
    const { tokens, bearer } = build({ run });
    await expect(
      tokens.authorise(
        bearer(tokens.signReply('run-1', 's1', 7)),
        'get_learner_history',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('can never call a debrief run’s tools, nor a debrief run token Ask Ally’s', async () => {
    const { tokens, bearer } = build({ run: published });
    await expect(
      tokens.authorise(
        bearer(tokens.signReply('run-1', 's1', 7)),
        'run_checks',
      ),
    ).rejects.toThrow('This run may not call run_checks');
    const { tokens: t2, bearer: b2 } = build();
    await expect(t2.authorise(b2(), 'get_learner_history')).rejects.toThrow(
      'This run may not call get_learner_history',
    );
  });

  it('get_learner_history: the token’s learner, never one the body names', async () => {
    const { tokens, controller, bearer, context } = build({ run: published });
    const res = await controller.tool(
      'get_learner_history',
      bearer(tokens.signReply('run-1', 's1', 7)),
      { limit: 50, userId: 99 },
    );
    expect(res).toEqual({
      points: [
        { date: '2026-10-20', skill: 'Exploring risk', point: 'Ask directly' },
      ],
    });
    expect(context.pastWorkOnThis).toHaveBeenCalledWith(
      7,
      '6b0d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e6f',
      's1',
      10,
    );
  });

  it('get_live_detections: the session’s scenario', async () => {
    const { tokens, controller, bearer, context } = build({ run: published });
    const res = await controller.tool(
      'get_live_detections',
      bearer(tokens.signReply('run-1', 's1', 7)),
      {},
    );
    expect(res).toEqual({
      detections: [
        { behaviour: 'Asks about safety', detected: true, times: 2 },
      ],
    });
    expect(context.liveDetections).toHaveBeenCalledWith('s1', 41);
  });

  it('guidance_search works for a reply token on a published debrief', async () => {
    const { tokens, controller, bearer, retrieval } = build({ run: published });
    await controller.tool(
      'guidance_search',
      bearer(tokens.signReply('run-1', 's1', 7)),
      { topics: [{ situation: 'asking about suicide' }], per_moment: 3 },
    );
    expect(retrieval.search).toHaveBeenCalledTimes(1);
  });
});
