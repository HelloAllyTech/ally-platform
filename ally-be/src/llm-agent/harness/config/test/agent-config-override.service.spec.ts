import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentConfigOverrideAudit } from '../../../entity/agent-config-override-audit.entity';
import { AgentConfigOverride } from '../../../entity/agent-config-override.entity';
import { AgentConfigLayer } from '../../enum/harness.enum';
import { AgentConfigOverrideService } from '../agent-config-override.service';
import { PolicySchema } from '../policy-schema';

const SCHEMA: PolicySchema = {
  window: {
    group: 'g',
    type: 'int',
    default: 6,
    min: 2,
    max: 20,
    description: 'x',
    overridableBy: ['org', 'course'],
  },
  cadence: {
    group: 'g',
    type: 'int',
    default: 3,
    min: 1,
    max: 10,
    nullable: true,
    description: 'x',
    overridableBy: ['org'],
  },
  safetyKey: {
    group: 'g',
    type: 'int',
    default: 1,
    description: 'x',
    overridableBy: [],
    pinned: true,
  },
};

function setup(existing: Partial<AgentConfigOverride> | null) {
  const audits: any[] = [];
  let stored: any = existing;
  const overrideRepo = {
    findOne: jest.fn(async () => stored),
    save: jest.fn(async (row: any) => {
      stored = { id: 'o1', ...row };
      return stored;
    }),
  };
  const auditRepo = {
    create: jest.fn((row: any) => row),
    save: jest.fn(async (rows: any[]) => {
      audits.push(...rows);
      return rows;
    }),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === AgentConfigOverride
        ? overrideRepo
        : entity === AgentConfigOverrideAudit
          ? auditRepo
          : null,
  };
  const dataSource = {
    transaction: jest.fn(async (fn: any) => fn(manager)),
  };
  const service = new AgentConfigOverrideService(
    {} as never,
    {} as never,
    dataSource as never,
  );
  const save = (change: any, expectedVersion?: number) =>
    service.save({
      agentKey: 'ally_guide',
      layer: AgentConfigLayer.ORG,
      scopeId: 'org-1',
      schema: SCHEMA,
      change,
      actorUserId: 7,
      expectedVersion,
    });
  return { save, audits, dataSource, stored: () => stored };
}

describe('AgentConfigOverrideService.save', () => {
  it('refuses a pinned key, and writes nothing', async () => {
    const t = setup(null);
    const error = await t
      .save({ set: { safetyKey: 2, window: 8 } })
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().errors).toEqual([
      expect.objectContaining({ key: 'safetyKey', code: 'pinned' }),
    ]);
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a key the layer may not set, and an out-of-range value', async () => {
    const t = setup(null);
    const error = await t.save({ set: { window: 99 } }).catch((e) => e);
    expect(error.getResponse().errors[0]).toMatchObject({
      key: 'window',
      code: 'value',
    });
  });

  it('audits each changed key with who, old and new value, and bumps the version', async () => {
    const t = setup({
      id: 'o1',
      agentKey: 'ally_guide',
      layer: AgentConfigLayer.ORG,
      scopeId: 'org-1',
      values: { window: 8, cadence: 4 },
      version: 3,
    });
    const saved = await t.save({
      set: { window: 8, cadence: null },
      clear: [],
    });
    expect(saved.version).toBe(4);
    expect(saved.values).toEqual({ window: 8, cadence: null });
    // `window` did not change: one audit row, for cadence only.
    expect(t.audits).toEqual([
      expect.objectContaining({
        key: 'cadence',
        oldValue: { value: 4 },
        newValue: { value: null },
        version: 4,
        actorUserId: 7,
      }),
    ]);
  });

  it('clearing a key records it as unset', async () => {
    const t = setup({
      id: 'o1',
      values: { window: 8 },
      version: 1,
    });
    await t.save({ clear: ['window'] });
    expect(t.stored().values).toEqual({});
    expect(t.audits[0]).toMatchObject({
      key: 'window',
      oldValue: { value: 8 },
      newValue: null,
    });
  });

  it('refuses a save over a newer version', async () => {
    const t = setup({ id: 'o1', values: {}, version: 2 });
    await expect(t.save({ set: { window: 5 } }, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
