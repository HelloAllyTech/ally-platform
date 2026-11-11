import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DebriefGatewayController } from '../controller/debrief-gateway.controller';
import { DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefGatewayService } from '../service/debrief-gateway.service';
import {
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
    loadSession: jest.fn(async () => ({ tenantId: 't-from-session' })),
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
  const reviews = {
    commentsForAgent: jest.fn(async () => ({
      comments: [],
      next_since: null,
    })),
  };
  const controller = new DebriefGatewayController(
    tokens,
    gateway,
    reviews as any,
  );
  const bearer = (t = tokens.sign('run-1', 's1')) => `Bearer ${t}`;
  return { tokens, controller, runs, context, retrieval, bearer, reviews };
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

describe('comments_read (the PM agent reads expert comments)', () => {
  it('answers an agent token that lists it, passing the filters through', async () => {
    const { controller, tokens, reviews, runs } = build();
    const token = tokens.signAgent('pm-run-1');
    const out = await controller.tool('comments_read', `Bearer ${token}`, {
      since: '2026-11-01T00:00:00Z',
      status: 'open',
    });
    expect(out).toEqual({ comments: [], next_since: null });
    expect(reviews.commentsForAgent).toHaveBeenCalledWith({
      since: '2026-11-01T00:00:00Z',
      status: 'open',
    });
    // No debrief run is involved: the agent token is not a run token.
    expect(runs.findOne).not.toHaveBeenCalled();
  });

  it('refuses a debrief run token, even one that claims the tool', async () => {
    const { controller, tokens, reviews } = build();
    const runToken = tokens.sign('run-1', 's1', ['comments_read']);
    await expect(
      controller.tool('comments_read', `Bearer ${runToken}`, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(reviews.commentsForAgent).not.toHaveBeenCalled();
  });

  it('never lets an agent token call a debrief run tool', async () => {
    const { controller, tokens } = build();
    const token = tokens.signAgent('pm-run-1');
    await expect(
      controller.tool('render_cards', `Bearer ${token}`, { cards }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an agent token without the tool, and a missing token', async () => {
    const { controller, tokens } = build();
    const none = tokens.signAgent('pm-run-1', []);
    await expect(
      controller.tool('comments_read', `Bearer ${none}`, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.tool('comments_read', undefined, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('is not among the tools a debrief run is signed for by default', () => {
    expect(DEBRIEF_GATEWAY_TOOLS as readonly string[]).not.toContain(
      'comments_read',
    );
  });
});
