import { UnauthorizedException } from '@nestjs/common';
import {
  ContextLibraryMcpController,
  MCP_SERVICE_SESSION,
  isServiceKey,
} from '../context-library-mcp.controller';

function build(apiKey = 'service-key') {
  const keys = {
    verify: jest.fn(async (authorization?: string) => {
      if (authorization === 'Bearer clr_good') return { id: 'k1' };
      throw new UnauthorizedException(
        'A Context Library reader key is required.',
      );
    }),
  };
  const tools = {
    definitions: jest.fn(() => []),
    runSearch: jest.fn(async () => ({ modelResult: { results: [] } })),
    runGet: jest.fn(),
  };
  const access = {
    grantedCollections: jest.fn(async () => []),
    resolve: jest.fn(async () => ({ denied: [] })),
  };
  const controller = new ContextLibraryMcpController(
    keys as any,
    tools as any,
    access as any,
    { apiKey } as any,
  );
  const res = () => {
    const r: any = {};
    r.status = jest.fn(() => r);
    r.json = jest.fn(() => r);
    r.end = jest.fn(() => r);
    return r;
  };
  const search = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'search_context', arguments: { queries: ['empty state'] } },
  };
  return { controller, keys, tools, res, search };
}

describe('ContextLibraryMcpController authentication', () => {
  it('compares the service key in constant time and refuses an unset one', () => {
    expect(isServiceKey('abc', 'abc')).toBe(true);
    expect(isServiceKey('abd', 'abc')).toBe(false);
    expect(isServiceKey('abc-longer', 'abc')).toBe(false);
    expect(isServiceKey('', '')).toBe(false);
    expect(isServiceKey(undefined, 'abc')).toBe(false);
    expect(isServiceKey(['abc'], 'abc')).toBe(false);
  });

  it('accepts the service key as the mcp_dev use case, under one session id', async () => {
    const { controller, keys, tools, res, search } = build();
    const r = res();
    await controller.mcp(undefined, 'service-key', search, r);
    expect(keys.verify).not.toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalledWith(401);
    expect(tools.runSearch).toHaveBeenCalledWith(
      'mcp_dev',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ sessionId: MCP_SERVICE_SESSION }),
    );
  });

  it('refuses a wrong service key, and any service key when none is configured', async () => {
    for (const [configured, presented] of [
      ['service-key', 'nope'],
      ['', ''],
    ]) {
      const { controller, tools, res, search } = build(configured);
      const r = res();
      await controller.mcp(undefined, presented, search, r);
      expect(r.status).toHaveBeenCalledWith(401);
      expect(tools.runSearch).not.toHaveBeenCalled();
    }
  });

  it('judges a request with a reader key on that key alone', async () => {
    const { controller, keys, tools, res, search } = build();
    const r = res();
    await controller.mcp('Bearer clr_good', 'nope', search, r);
    expect(keys.verify).toHaveBeenCalledWith('Bearer clr_good');
    expect(tools.runSearch).toHaveBeenCalledWith(
      'mcp_dev',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ sessionId: 'mcp:k1' }),
    );

    const bad = build();
    const r2 = bad.res();
    await bad.controller.mcp('Bearer clr_bad', 'service-key', search, r2);
    expect(r2.status).toHaveBeenCalledWith(401);
  });

  it('still asks for a reader key when no key is sent at all', async () => {
    const { controller, res, search } = build();
    const r = res();
    await controller.mcp(undefined, undefined, search, r);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(r.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'A Context Library reader key is required.',
        }),
      }),
    );
  });
});
