import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DebriefRunTokenService } from '../../../debrief/service/debrief-run-token.service';
import { ToolRunStatus } from '../../entity/tool-run.entity';
import { AgentGatewayController } from '../agent-gateway.controller';
import { AGENT_RUN_TOKEN_TTL_S } from '../agent-run-token.service';
import {
  appConfig,
  BOT_A,
  BOT_B,
  CONV_A,
  makeGateway,
  RecordingTool,
  SERVICE_KEY,
} from './agent-tools.fakes';

const claimsFor = (overrides: Record<string, unknown> = {}) => ({
  chatbotId: BOT_A,
  conversationId: CONV_A,
  runId: 'run-1',
  contactId: null,
  tools: ['note_it'],
  ...overrides,
});

function setup(
  opts: { abilities?: Record<string, string> | null; tools?: string[] } = {},
) {
  const tool = new RecordingTool('note_it');
  const other = new RecordingTool('other_tool');
  const built = makeGateway([tool, other]);
  built.db.bots.set(BOT_A, {
    abilities:
      opts.abilities === null
        ? undefined
        : ((opts.abilities ?? {
            note_it: 'do_it',
            other_tool: 'do_it',
          }) as never),
  });
  built.db.bots.set(BOT_B, { abilities: { note_it: 'do_it' } });
  const token = built.tokens.sign(
    claimsFor({ tools: opts.tools ?? ['note_it', 'other_tool'] }),
  );
  const headers = { apiKey: SERVICE_KEY, authorization: `Bearer ${token}` };
  const call = (
    name = 'note_it',
    body: unknown = { run_id: 'run-1', step: 0, input: { note: 'hi' } },
    h: { apiKey?: string; authorization?: string } = headers,
  ) => built.gateway.call(name, h, body);
  return { ...built, tool, other, token, headers, call };
}

describe('AgentRunTokenService', () => {
  const { tokens } = makeGateway([]);

  it('signs a chatbot_run token that verifies with its claims and a 2-minute expiry', () => {
    const token = tokens.sign(claimsFor({ contactId: 'contact-1' }));
    const claims = tokens.verify(`Bearer ${token}`);
    expect(claims).toMatchObject({
      kind: 'chatbot_run',
      chatbotId: BOT_A,
      conversationId: CONV_A,
      runId: 'run-1',
      contactId: 'contact-1',
      tools: ['note_it'],
    });
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      AGENT_RUN_TOKEN_TTL_S,
    );
  });

  it('builds the gateway URL from PUBLIC_API_BASE_URL', () => {
    expect(tokens.gatewayUrl()).toBe(
      'http://host.docker.internal:8001/api/v1/internal/agent',
    );
  });

  it('refuses a missing, expired or badly signed token, and one of another kind', () => {
    expect(() => tokens.verify(undefined)).toThrow(UnauthorizedException);
    const secret = (tokens as any).secret();
    const expired = jwt.sign(
      {
        ...claimsFor(),
        kind: 'chatbot_run',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      secret,
    );
    expect(() => tokens.verify(`Bearer ${expired}`)).toThrow(
      'Run token expired',
    );
    const forged = jwt.sign({ ...claimsFor(), kind: 'chatbot_run' }, 'wrong');
    expect(() => tokens.verify(`Bearer ${forged}`)).toThrow(
      UnauthorizedException,
    );
    const otherKind = jwt.sign({ ...claimsFor(), kind: 'agent' }, secret);
    expect(() => tokens.verify(`Bearer ${otherKind}`)).toThrow(
      UnauthorizedException,
    );
  });

  it('never shares a secret with Debrief, even when both are derived', () => {
    const debrief = new DebriefRunTokenService(appConfig(), {} as never);
    expect((tokens as any).secret()).not.toBe((debrief as any).secret());
  });

  it('refuses a Debrief token here, and Debrief refuses an agent token', () => {
    // The same explicit secret on both sides: the claims alone keep them apart.
    const config = appConfig({
      agentGatewaySecret: 'shared',
      debriefGatewaySecret: 'shared',
    });
    const agentTokens = makeGateway([], config).tokens;
    const debrief = new DebriefRunTokenService(config, {} as never);
    const debriefToken = debrief.sign('run-1', 'session-1');
    expect(() => agentTokens.verify(`Bearer ${debriefToken}`)).toThrow(
      UnauthorizedException,
    );
    const agentToken = agentTokens.sign(claimsFor());
    expect(() => debrief.verify(agentToken)).toThrow(UnauthorizedException);
    expect(() =>
      debrief.authoriseAgent(`Bearer ${agentToken}`, 'comments_read'),
    ).toThrow(UnauthorizedException);
  });
});

describe('AgentGatewayService', () => {
  describe('the checks, in order', () => {
    it('401s a missing or wrong service key before reading the token', async () => {
      const { call, headers, tool } = setup();
      await expect(
        call('note_it', undefined, { authorization: headers.authorization }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        call('note_it', undefined, { ...headers, apiKey: 'nope' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        call('no_such_tool', undefined, { ...headers, apiKey: 'nope' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(tool.calls).toHaveLength(0);
    });

    it('401s a bad token', async () => {
      const { call } = setup();
      await expect(
        call('note_it', undefined, {
          apiKey: SERVICE_KEY,
          authorization: 'Bearer x.y.z',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('404s a tool it does not serve', async () => {
      const { call } = setup();
      await expect(call('no_such_tool')).rejects.toThrow(NotFoundException);
    });

    it('403s a tool the token does not list', async () => {
      const { call, tool } = setup({ tools: ['other_tool'] });
      await expect(call('note_it')).rejects.toThrow(ForbiddenException);
      expect(tool.calls).toHaveLength(0);
    });

    it('403s a tool turned off since the run started', async () => {
      const { call, db, tool } = setup();
      db.bots.set(BOT_A, { abilities: { note_it: 'never' } });
      await expect(call('note_it')).rejects.toThrow(ForbiddenException);
      db.bots.set(BOT_A, {});
      await expect(call('note_it')).rejects.toThrow(ForbiddenException);
      expect(tool.calls).toHaveLength(0);
    });

    it('reads abilities only from the bot: a platform-wide value turns nothing on', async () => {
      const { call, db, tool } = setup({ abilities: null });
      Object.assign(db.platformSettings, { abilities: { note_it: 'do_it' } });
      await expect(call('note_it')).rejects.toThrow(ForbiddenException);
      expect(tool.calls).toHaveLength(0);
    });

    it('400s unknown body fields, a bad step and unknown input fields', async () => {
      const { call } = setup();
      await expect(
        call('note_it', {
          run_id: 'run-1',
          step: 0,
          input: {},
          chatbot_id: BOT_B,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        call('note_it', { run_id: 'run-1', step: 4, input: {} }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        call('note_it', { run_id: 'run-1', step: 1.5, input: {} }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        call('note_it', {
          run_id: 'run-1',
          step: 0,
          input: { conversation_id: CONV_A },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("403s a body naming another run than the token's", async () => {
      const { call } = setup();
      await expect(
        call('note_it', { run_id: 'run-2', step: 0, input: {} }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('a call', () => {
    it("runs once, on the token's bot and conversation, and records ok with its time", async () => {
      const { call, db, tool } = setup();
      await expect(call()).resolves.toEqual({
        ok: true,
        result: { done: true },
        replayed: false,
      });
      expect(tool.calls).toEqual([
        {
          ctx: {
            chatbotId: BOT_A,
            conversationId: CONV_A,
            runId: 'run-1',
            contactId: null,
          },
          input: { note: 'hi' },
        },
      ]);
      expect(db.runs).toHaveLength(1);
      expect(db.runs[0]).toMatchObject({
        chatbot_id: BOT_A,
        conversation_id: CONV_A,
        run_id: 'run-1',
        step: 0,
        tool: 'note_it',
        input: { note: 'hi' },
        status: ToolRunStatus.OK,
        result: { done: true },
      });
      expect(typeof db.runs[0].duration_ms).toBe('number');
    });

    it('records a failure, and a tool that throws, as error results', async () => {
      const { call, db, tool } = setup();
      tool.outcome = { ok: false, error: 'no_conversation' };
      await expect(call()).resolves.toEqual({
        ok: false,
        error: 'no_conversation',
        replayed: false,
      });
      expect(db.runs[0]).toMatchObject({
        status: ToolRunStatus.ERROR,
        error_code: 'no_conversation',
      });
      tool.run = async () => {
        throw new Error('boom');
      };
      await expect(
        call('note_it', { run_id: 'run-1', step: 1, input: {} }),
      ).resolves.toEqual({ ok: false, error: 'internal', replayed: false });
    });

    it('replays the same run and step: the stored result, whatever the input says, running nothing', async () => {
      const { call, db, tool } = setup();
      await call();
      await expect(
        call('note_it', {
          run_id: 'run-1',
          step: 0,
          input: { note: 'rephrased' },
        }),
      ).resolves.toEqual({ ok: true, result: { done: true }, replayed: true });
      expect(tool.calls).toHaveLength(1);
      expect(db.runs).toHaveLength(1);
    });

    it('replays a stored error rather than running it again', async () => {
      const { call, tool } = setup();
      tool.outcome = { ok: false, error: 'no_conversation' };
      await call();
      tool.outcome = { ok: true, result: {} };
      await expect(call()).resolves.toEqual({
        ok: false,
        error: 'no_conversation',
        replayed: true,
      });
      expect(tool.calls).toHaveLength(1);
    });

    it('409s another tool at the same step', async () => {
      const { call, other } = setup();
      await call();
      await expect(
        call('other_tool', { run_id: 'run-1', step: 0, input: {} }),
      ).rejects.toThrow(ConflictException);
      expect(other.calls).toHaveLength(0);
    });

    it('409s a step still running, and claims a stale one again', async () => {
      const { call, db, tool } = setup();
      db.runs.push({
        id: 'stuck',
        chatbot_id: BOT_A,
        conversation_id: CONV_A,
        run_id: 'run-1',
        step: 0,
        tool: 'note_it',
        input: {},
        status: ToolRunStatus.STARTED,
        result: null,
        error_code: null,
        duration_ms: null,
        updatedAt: new Date(),
      });
      await expect(call()).rejects.toMatchObject({
        response: { errorCode: 'in_progress' },
      });
      expect(tool.calls).toHaveLength(0);

      db.runs[0].updatedAt = new Date(Date.now() - 31_000);
      await expect(call()).resolves.toMatchObject({
        ok: true,
        replayed: false,
      });
      expect(tool.calls).toHaveLength(1);
      expect(db.runs).toHaveLength(1);
      expect(db.runs[0].status).toBe(ToolRunStatus.OK);
    });
  });

  it('the controller passes the name, both credentials and the body through', async () => {
    const gateway = {
      call: jest
        .fn()
        .mockResolvedValue({ ok: true, result: {}, replayed: false }),
    };
    const controller = new AgentGatewayController(gateway as never);
    await controller.tool('hand_over', 'key', 'Bearer t', { run_id: 'r' });
    expect(gateway.call).toHaveBeenCalledWith(
      'hand_over',
      { apiKey: 'key', authorization: 'Bearer t' },
      { run_id: 'r' },
    );
  });
});
