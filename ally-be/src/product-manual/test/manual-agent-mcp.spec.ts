import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from 'src/auth/decorators/auth.metadata';
import {
  FEATURE_TOGGLE_KEY,
  FeatureToggleOptions,
} from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { ManualAgentAdminController } from '../controller/manual-agent-admin.controller';
import { ManualChatController } from '../controller/manual-chat.controller';
import {
  MANUAL_MCP_TOOLS,
  ManualMcpController,
} from '../controller/manual-mcp.controller';
import {
  hashManualKey,
  ManualAgentKeyService,
  ManualKeyRateLimitedException,
} from '../service/manual-agent-key.service';

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined, ended: false };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = jest.fn(() => {
    res.ended = true;
    return res;
  });
  return res;
}

function mcpSetup(
  verify: () => Promise<any> = async () => ({ id: 'key-1', ownerId: 3 }),
) {
  const keys = { verify: jest.fn(verify) };
  const pages = {
    getBySlug: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
  };
  const search = { search: jest.fn().mockResolvedValue([]) };
  const proposals = { create: jest.fn().mockResolvedValue({ id: 'prop-1' }) };
  const controller = new ManualMcpController(
    keys as never,
    pages as never,
    search as never,
    proposals as never,
  );
  return { controller, keys, proposals, search };
}

describe('ManualMcpController', () => {
  it('answers a bad key with a 401 JSON-RPC error', async () => {
    const { controller } = mcpSetup(async () => {
      throw new UnauthorizedException(
        'That key is not valid or has been revoked.',
      );
    });
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_nope',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32001,
        message: 'That key is not valid or has been revoked.',
      },
    });
  });

  it('answers a rate-limited key with 429', async () => {
    const { controller } = mcpSetup(async () => {
      throw new ManualKeyRateLimitedException();
    });
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      res,
    );
    expect(res.statusCode).toBe(429);
  });

  it('lists read and propose tools only — nothing that edits a page', async () => {
    const { controller } = mcpSetup();
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      res,
    );
    const listed = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(listed).toEqual([
      'search_manual',
      'read_manual_page',
      'list_manual_pages',
      'propose_manual_change',
    ]);
    expect(
      listed.some((n: string) => /edit|write|create|update|delete/.test(n)),
    ).toBe(false);
    const propose = MANUAL_MCP_TOOLS.find(
      (t) => t.name === 'propose_manual_change',
    )!;
    expect(propose.description).toContain(
      'after changing user-visible behaviour: a screen, label, route, role gate, setting, notification, or limit',
    );
  });

  it('files a proposal from a coding agent and returns the PR trailer', async () => {
    const { controller, proposals } = mcpSetup();
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'propose_manual_change',
          arguments: {
            kind: 'edit',
            pageSlug: 'roleplays',
            summary: 'The start button moved.',
          },
        },
      },
      res,
    );
    expect(proposals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'edit',
        pageSlug: 'roleplays',
        summary: 'The start button moved.',
        source: 'coding_agent',
        keyId: 'key-1',
        submittedBy: 3,
      }),
    );
    expect(JSON.parse(res.body.result.content[0].text)).toEqual({
      ok: true,
      proposalId: 'prop-1',
      trailer: 'Manual: proposal prop-1',
    });
  });

  it('returns a proposal error as an isError tool result, not a crash', async () => {
    const { controller, proposals } = mcpSetup();
    proposals.create.mockRejectedValueOnce(
      new Error('The summary: it contains an email address.'),
    );
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'propose_manual_change',
          arguments: { kind: 'gap', summary: 'x' },
        },
      },
      res,
    );
    expect(res.body.result.isError).toBe(true);
  });

  it('returns search snippets as plain text', async () => {
    const { controller, search } = mcpSetup();
    search.search.mockResolvedValueOnce([
      {
        slug: 'badges',
        title: 'Badges',
        parentTitle: null,
        snippet: '<mark>&quot;new badge&quot;</mark> &amp; more',
        rank: 1,
      },
    ]);
    const res = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_manual', arguments: { query: 'badge' } },
      },
      res,
    );
    expect(JSON.parse(res.body.result.content[0].text)[0].snippet).toBe(
      '"new badge" & more',
    );
  });

  it('accepts notifications with 202 and answers a batch as an array', async () => {
    const { controller } = mcpSetup();
    const note = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      note,
    );
    expect(note.statusCode).toBe(202);
    expect(note.ended).toBe(true);

    const batch = fakeRes();
    await controller.mcp(
      'Bearer pmk_x',
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ],
      batch,
    );
    expect(batch.body.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    expect(batch.body[0].result.protocolVersion).toBe('2025-06-18');
  });
});

describe('ManualAgentKeyService', () => {
  const setup = (row: any = null, count = 1) => {
    const repo = {
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'key-1', ...v })),
      findOne: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const redis = {
      incrWithExpiry: jest.fn().mockResolvedValue({ count, ttlSeconds: 60 }),
    };
    return {
      service: new ManualAgentKeyService(repo as never, redis as never),
      repo,
      redis,
    };
  };

  it('stores only the sha256 of a pmk_ key and returns the plaintext once', async () => {
    const { service, repo } = setup();
    const { id, key } = await service.create(3, 'CI runner');
    expect(id).toBe('key-1');
    expect(key).toMatch(/^pmk_[A-Za-z0-9_-]{32}$/);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.keyHash).toBe(hashManualKey(key));
    expect(saved.keyHash).toHaveLength(64);
    expect(JSON.stringify(saved)).not.toContain(key);
    expect(saved.keyPrefix).toBe(key.slice(0, 10));
  });

  it('verifies by hash among unrevoked keys, and rejects other prefixes', async () => {
    const { service, repo } = setup({ id: 'key-1', lastUsedAt: new Date() });
    await expect(service.verify('Bearer clr_abc')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await service.verify('Bearer pmk_abc');
    expect(repo.findOne.mock.calls[0][0].where.keyHash).toBe(
      hashManualKey('pmk_abc'),
    );
    expect(repo.findOne.mock.calls[0][0].where.revokedAt).toBeDefined();
    // Used within the minute: last_used_at is not rewritten.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a revoked (not found) key', async () => {
    const { service } = setup(null);
    await expect(service.verify('Bearer pmk_abc')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rate limits at 60 a minute per key', async () => {
    const { service, redis } = setup({ id: 'key-1', lastUsedAt: null }, 61);
    await expect(service.verify('Bearer pmk_abc')).rejects.toBeInstanceOf(
      ManualKeyRateLimitedException,
    );
    expect(redis.incrWithExpiry.mock.calls[0][0]).toMatch(
      /^product-manual:mcp:rate:key-1:\d+$/,
    );
  });

  it('revokes a key by stamping revoked_at', async () => {
    const { service, repo } = setup({ id: 'key-1', revokedAt: null });
    await service.revoke('key-1');
    expect(repo.update).toHaveBeenCalledWith('key-1', {
      revokedAt: expect.any(Date),
    });
  });
});

describe('Agent controllers: every route carries a toggle, except the MCP which is @Public', () => {
  const handlers = (cls: any) =>
    Object.getOwnPropertyNames(cls.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ name, fn: cls.prototype[name] }))
      .filter(
        ({ fn }) => Reflect.getMetadata(METHOD_METADATA, fn) !== undefined,
      );

  it.each([
    [ManualChatController, FeatureToggleKey.PRODUCT_MANUAL],
    [ManualAgentAdminController, FeatureToggleKey.PRODUCT_ROADMAP_MANAGE],
  ])('%p', (cls, key) => {
    const routes = handlers(cls);
    expect(routes.length).toBeGreaterThan(0);
    for (const { name, fn } of routes) {
      const options = Reflect.getMetadata(
        FEATURE_TOGGLE_KEY,
        fn,
      ) as FeatureToggleOptions;
      expect({ name, key: options?.featureKey }).toEqual({ name, key });
    }
  });

  it('MCP', () => {
    const routes = handlers(ManualMcpController);
    expect(routes.map((r) => Reflect.getMetadata(PATH_METADATA, r.fn))).toEqual(
      ['mcp'],
    );
    for (const { fn } of routes) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
      expect(Reflect.getMetadata(FEATURE_TOGGLE_KEY, fn)).toBeUndefined();
    }
  });
});
