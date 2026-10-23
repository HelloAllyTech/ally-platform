import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { AgentReleaseAudit } from 'src/llm-agent/entity/agent-release-audit.entity';
import {
  AgentReleaseAuditAction,
  AgentReleaseStatus,
} from '../../enum/harness.enum';
import { AgentReleaseService, inCanary } from '../agent-release.service';

/** A tiny in-memory stand-in for the two repositories and transactions. */
function fakeDataSource() {
  const releases: AgentRelease[] = [];
  const audit: AgentReleaseAudit[] = [];
  let id = 0;
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
  const repoFor = (entity: unknown) => {
    const rows: any[] = entity === AgentRelease ? releases : audit;
    return {
      findOne: jest.fn(async ({ where, order }: any) => {
        const found = rows.filter((r) => matches(r, where));
        if (order?.version === 'DESC')
          found.sort((a, b) => b.version - a.version);
        return found[0] ?? null;
      }),
      find: jest.fn(async ({ where, order }: any) => {
        const found = rows.filter((r) => matches(r, where));
        if (order?.createdAt === 'DESC') found.reverse();
        if (order?.version === 'DESC')
          found.sort((a, b) => b.version - a.version);
        return found;
      }),
      count: jest.fn(
        async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
      ),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => {
        const saved = { id: `id-${++id}`, createdAt: new Date(), ...row };
        rows.push(saved);
        return saved;
      }),
      update: jest.fn(async (rowId: string, patch: any) => {
        Object.assign(
          rows.find((r) => r.id === rowId),
          patch,
        );
      }),
    };
  };
  const repos = new Map<unknown, ReturnType<typeof repoFor>>();
  const getRepository = (entity: unknown) => {
    if (!repos.has(entity)) repos.set(entity, repoFor(entity));
    return repos.get(entity)!;
  };
  return {
    releases,
    audit,
    dataSource: {
      getRepository,
      transaction: async (fn: any) =>
        fn({ getRepository, query: jest.fn(async () => []) }),
    },
  };
}

describe('AgentReleaseService', () => {
  it('seeds version 1 as GA once, and is idempotent', async () => {
    const fake = fakeDataSource();
    const service = new AgentReleaseService(fake.dataSource as never);

    const first = await service.ensureSeed('ally_guide', { policy: { a: 1 } });
    const second = await service.ensureSeed('ally_guide', { policy: { a: 1 } });

    expect(first?.version).toBe(1);
    expect(first?.status).toBe(AgentReleaseStatus.GA);
    expect(second?.id).toBe(first?.id);
    expect(fake.releases).toHaveLength(1);
    expect(fake.audit.map((a) => a.action)).toEqual([
      AgentReleaseAuditAction.CREATED,
    ]);
  });

  it('never re-seeds over releases that exist without a GA', async () => {
    const fake = fakeDataSource();
    fake.releases.push({
      id: 'r1',
      agentKey: 'ally_guide',
      version: 1,
      status: AgentReleaseStatus.RETIRED,
    } as AgentRelease);
    const service = new AgentReleaseService(fake.dataSource as never);

    await service.ensureSeed('ally_guide', {});

    expect(fake.releases).toHaveLength(1);
  });

  it('promotes a draft, retiring the previous GA, and rolls back to it', async () => {
    const fake = fakeDataSource();
    const service = new AgentReleaseService(fake.dataSource as never);
    const v1 = await service.ensureSeed('ally_guide', { v: 1 });
    const v2 = await service.createDraft('ally_guide', { v: 2 }, 7, 'warmer');

    expect(v2.version).toBe(2);
    expect(v2.status).toBe(AgentReleaseStatus.DRAFT);

    await service.makeGa(v2.id, 7);
    expect(fake.releases.find((r) => r.id === v1?.id)?.status).toBe(
      AgentReleaseStatus.RETIRED,
    );
    expect((await service.getGa('ally_guide'))?.id).toBe(v2.id);

    const back = await service.rollback('ally_guide', 7, true, 'crisis spike');
    expect(back.id).toBe(v1?.id);
    expect((await service.getGa('ally_guide'))?.id).toBe(v1?.id);
    expect(fake.audit[fake.audit.length - 1]?.action).toBe(
      AgentReleaseAuditAction.EMERGENCY_ROLLBACK,
    );
    expect(fake.audit[fake.audit.length - 1]?.detail).toMatchObject({
      reason: 'crisis spike',
    });
  });

  it('refuses a rollback when there is nothing to go back to', async () => {
    const fake = fakeDataSource();
    const service = new AgentReleaseService(fake.dataSource as never);
    await service.ensureSeed('ally_guide', {});

    await expect(service.rollback('ally_guide', 7, false)).rejects.toThrow(
      'no earlier GA release',
    );
  });

  it('gives identical bundles identical content hashes', async () => {
    const fake = fakeDataSource();
    const service = new AgentReleaseService(fake.dataSource as never);
    await service.ensureSeed('ally_guide', { a: 1, b: 2 });
    const draft = await service.createDraft('ally_guide', { b: 2, a: 1 }, 1);
    expect(draft.contentHash).toBe(fake.releases[0].contentHash);
  });

  describe('syncSeed', () => {
    const v1 = { policy: { a: 1 } };
    const v2 = { policy: { a: 2 } };

    it('seeds version 1 as GA on first boot and is a no-op after', async () => {
      const fake = fakeDataSource();
      const service = new AgentReleaseService(fake.dataSource as never);
      const first = await service.syncSeed('ally_guide', v1);
      const again = await service.syncSeed('ally_guide', v1);
      expect(first).toMatchObject({
        version: 1,
        status: AgentReleaseStatus.GA,
      });
      expect(again?.id).toBe(first?.id);
      expect(fake.releases).toHaveLength(1);
    });

    it('ships changed code defaults as the next GA while only seeds have acted', async () => {
      const fake = fakeDataSource();
      const service = new AgentReleaseService(fake.dataSource as never);
      await service.syncSeed('ally_guide', v1);
      const next = await service.syncSeed('ally_guide', v2);
      expect(next).toMatchObject({ version: 2, status: AgentReleaseStatus.GA });
      expect(fake.releases.map((r) => r.status)).toEqual([
        AgentReleaseStatus.RETIRED,
        AgentReleaseStatus.GA,
      ]);
      expect(fake.audit[fake.audit.length - 1]).toMatchObject({
        action: AgentReleaseAuditAction.PROMOTED,
        actorKind: 'seed',
      });
    });

    it('never undoes a person’s rollback: changed defaults become a draft', async () => {
      const fake = fakeDataSource();
      const service = new AgentReleaseService(fake.dataSource as never);
      await service.syncSeed('ally_guide', v1);
      const two = await service.syncSeed('ally_guide', v2);
      await service.rollback('ally_guide', 7, false, 'bad tone');
      const afterBoot = await service.syncSeed('ally_guide', {
        policy: { a: 3 },
      });
      expect(afterBoot?.version).toBe(1);
      expect(fake.releases.find((r) => r.id === two?.id)?.status).toBe(
        AgentReleaseStatus.RETIRED,
      );
      expect(fake.releases[fake.releases.length - 1]).toMatchObject({
        version: 3,
        status: AgentReleaseStatus.DRAFT,
      });
    });

    it('does not pile up duplicate drafts across restarts', async () => {
      const fake = fakeDataSource();
      const service = new AgentReleaseService(fake.dataSource as never);
      await service.syncSeed('ally_guide', v1);
      await service.syncSeed('ally_guide', v2);
      await service.rollback('ally_guide', 7, false);
      await service.syncSeed('ally_guide', v2);
      await service.syncSeed('ally_guide', v2);
      expect(fake.releases).toHaveLength(2);
    });
  });

  describe('canary', () => {
    async function withDraft() {
      const fake = fakeDataSource();
      const service = new AgentReleaseService(fake.dataSource as never);
      await service.ensureSeed('ally_guide', { policy: { a: 1 } });
      const draft = await service.createDraft(
        'ally_guide',
        { policy: { a: 2 } },
        7,
      );
      return { fake, service, draft };
    }

    it('puts a draft in front of a share of epochs, one canary at a time, never over 30%', async () => {
      const { fake, service, draft } = await withDraft();
      await expect(service.startCanary(draft.id, 31, 7)).rejects.toThrow(
        '1–30%',
      );
      const started = await service.startCanary(draft.id, 20, 7, 'try it');
      expect(started).toMatchObject({ status: 'canary', rolloutPercent: 20 });
      expect((await service.getCanary('ally_guide'))?.id).toBe(draft.id);
      const second = await service.createDraft(
        'ally_guide',
        { policy: { a: 3 } },
        7,
      );
      await expect(service.startCanary(second.id, 10, 7)).rejects.toThrow(
        'already in canary',
      );
      expect(fake.audit.map((a) => a.action)).toContain(
        AgentReleaseAuditAction.CANARY_STARTED,
      );
    });

    it('promoting the canary makes it GA and ends the canary', async () => {
      const { service, draft } = await withDraft();
      await service.startCanary(draft.id, 20, 7);
      const ga = await service.makeGa(draft.id, 7);
      expect(ga.status).toBe(AgentReleaseStatus.GA);
      expect(await service.getCanary('ally_guide')).toBeNull();
      expect((await service.getGa('ally_guide'))?.id).toBe(draft.id);
    });

    it('stopping retires it; an emergency stop moves every thread at its next turn', async () => {
      const { fake, service, draft } = await withDraft();
      await service.startCanary(draft.id, 20, 7);
      const before = await service.lastEmergencyRollbackId('ally_guide');
      await service.stopCanary('ally_guide', 7, true, 'crisis spike');
      expect(fake.releases.find((r) => r.id === draft.id)?.status).toBe(
        AgentReleaseStatus.RETIRED,
      );
      expect(await service.getCanary('ally_guide')).toBeNull();
      expect(await service.lastEmergencyRollbackId('ally_guide')).not.toBe(
        before,
      );
      await expect(service.stopCanary('ally_guide', 7, false)).rejects.toThrow(
        'No release is in canary',
      );
    });
  });

  describe('inCanary', () => {
    it('is stable for a thread and close to the share across threads', () => {
      expect(inCanary('th-1', 'rel-c', 20)).toBe(inCanary('th-1', 'rel-c', 20));
      let hits = 0;
      for (let i = 0; i < 2000; i++) {
        if (inCanary(`th-${i}`, 'rel-c', 20)) hits++;
      }
      expect(hits / 2000).toBeGreaterThan(0.16);
      expect(hits / 2000).toBeLessThan(0.24);
      expect(inCanary('th-1', 'rel-c', 0)).toBe(false);
    });
  });
});
