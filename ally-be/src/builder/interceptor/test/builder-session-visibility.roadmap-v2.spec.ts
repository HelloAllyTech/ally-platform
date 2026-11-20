import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BuilderSessionVisibility } from '../../enum/builder.enum';
import {
  BuilderSessionVisibilityInterceptor,
  PlanParticipantWrite,
  PlanParticipantWriteKind,
} from '../builder-session-visibility.interceptor';

const SESSION = '0b9d2d7c-6a0e-4b1e-9f3a-2c1d5e6f7a8b';
const LEAD = 4;
const plan = (over: object = {}) => ({
  visibility: BuilderSessionVisibility.SHARED,
  createdBy: 1,
  kind: 'plan',
  leadUserId: LEAD,
  ...over,
});

class Handlers {
  @PlanParticipantWrite('answer') answer() {}
  @PlanParticipantWrite('comment') comment() {}
  @PlanParticipantWrite('settle') settle() {}
  stream() {}
}

function build(opts: {
  facts?: object;
  flag?: boolean;
  roles?: Record<number, string>;
}) {
  const interceptor = new BuilderSessionVisibilityInterceptor(
    { findVisibilityFacts: jest.fn(async () => opts.facts ?? plan()) } as never,
    new Reflector(),
    {
      roleOf: jest.fn(async (id: number) => opts.roles?.[id] ?? 'none'),
    } as never,
    {
      getRoadmapV2: jest.fn(async () => ({ enabled: opts.flag ?? true })),
    } as never,
  );
  const call = (
    handler: PlanParticipantWriteKind | 'stream',
    userId: number,
    method = 'POST',
  ) =>
    interceptor.intercept(
      {
        getType: () => 'http',
        getHandler: () => Handlers.prototype[handler],
        switchToHttp: () => ({
          getRequest: () => ({
            params: { sessionId: SESSION },
            user: { id: userId },
            method,
          }),
        }),
      } as never,
      { handle: () => 'handled' } as never,
    );
  return { call };
}

describe('BuilderSessionVisibilityInterceptor — Roadmap v2 (D13)', () => {
  it('lets any Roadmap role post an answer on a shared plan', async () => {
    const { call } = build({ roles: { 9: 'idea' } });
    await expect(call('answer', 9)).resolves.toBe('handled');
    await expect(call('settle', 9)).resolves.toBe('handled');
  });

  it('keeps every other write the lead’s, or an Owner’s', async () => {
    const { call } = build({ roles: { 9: 'idea', 5: 'builder', 6: 'owner' } });
    await expect(call('stream', 9)).rejects.toThrow(/lead/);
    await expect(call('stream', 5)).rejects.toThrow(/lead/);
    await expect(call('stream', LEAD)).resolves.toBe('handled');
    await expect(call('stream', 6)).resolves.toBe('handled');
  });

  it('a Viewer may comment but not answer; no role may do either', async () => {
    const { call } = build({ roles: { 8: 'viewer' } });
    await expect(call('comment', 8)).resolves.toBe('handled');
    await expect(call('answer', 8)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(call('comment', 99)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('with roadmap_v2 off nothing changes: participant writes 404, Owners are not the lead', async () => {
    const { call } = build({ flag: false, roles: { 9: 'idea', 6: 'owner' } });
    await expect(call('answer', 9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(call('stream', 6)).rejects.toThrow(/lead/);
    await expect(call('stream', LEAD)).resolves.toBe('handled');
  });

  it('a private draft stays closed to every Builder write', async () => {
    const { call } = build({
      facts: plan({
        visibility: BuilderSessionVisibility.PRIVATE,
        createdBy: 9,
      }),
      roles: { 9: 'idea' },
    });
    await expect(call('answer', 9)).rejects.toThrow(/private/);
  });
});
