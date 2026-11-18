import { ForbiddenException } from '@nestjs/common';
import { BuilderSessionVisibility } from '../../enum/builder.enum';
import { BuilderPlanReadGuard } from '../builder-plan-read.guard';

const SESSION = '0b9d2d7c-6a0e-4b1e-9f3a-2c1d5e6f7a8b';
const RUN = '1b9d2d7c-6a0e-4b1e-9f3a-2c1d5e6f7a8b';

function build(opts: {
  builderOk?: boolean;
  flag?: boolean;
  role?: string;
  kind?: string;
  visibility?: BuilderSessionVisibility;
}) {
  const deny = async () => {
    throw new ForbiddenException('no builder');
  };
  const guard = new BuilderPlanReadGuard(
    { canActivate: jest.fn(async () => true) } as never,
    {
      canActivate: opts.builderOk ? jest.fn(async () => true) : jest.fn(deny),
    } as never,
    {
      findVisibilityFacts: jest.fn(async () => ({
        kind: opts.kind ?? 'plan',
        visibility: opts.visibility ?? BuilderSessionVisibility.SHARED,
      })),
    } as never,
    { findOne: jest.fn(async () => ({ sessionId: SESSION })) } as never,
    {
      getRoadmapV2: jest.fn(async () => ({ enabled: opts.flag ?? true })),
    } as never,
    { roleOf: jest.fn(async () => opts.role ?? 'idea') } as never,
  );
  const call = (method = 'GET', params: object = { sessionId: SESSION }) =>
    guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ method, params, user: { id: 9 } }),
      }),
    } as never);
  return { call };
}

describe('BuilderPlanReadGuard (Roadmap v2 D2)', () => {
  it('lets an Idea user GET a shared plan, by session or by run', async () => {
    const { call } = build({});
    await expect(call()).resolves.toBe(true);
    await expect(call('GET', { runId: RUN })).resolves.toBe(true);
  });

  it.each(['builder', 'owner'])(
    'lets a %s through the same way',
    async (role) => {
      await expect(build({ role }).call()).resolves.toBe(true);
    },
  );

  it('leaves a Builder user to Builder’s own gate', async () => {
    const { call } = build({ builderOk: true, flag: false, kind: 'build' });
    await expect(call('POST')).resolves.toBe(true);
  });

  it('refuses writes', async () => {
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      await expect(build({}).call(m)).rejects.toThrow(ForbiddenException);
    }
  });

  it('refuses a private draft and a non-plan session', async () => {
    await expect(
      build({ visibility: BuilderSessionVisibility.PRIVATE }).call(),
    ).rejects.toThrow(ForbiddenException);
    await expect(build({ kind: 'build' }).call()).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a Viewer, no role, and everything while the flag is off', async () => {
    await expect(build({ role: 'viewer' }).call()).rejects.toThrow(
      ForbiddenException,
    );
    await expect(build({ role: 'none' }).call()).rejects.toThrow(
      ForbiddenException,
    );
    await expect(build({ flag: false }).call()).rejects.toThrow(
      ForbiddenException,
    );
  });
});
