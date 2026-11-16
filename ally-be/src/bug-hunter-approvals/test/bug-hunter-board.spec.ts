import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StartBugDto, UpdateModeDto } from '../dto/board.dto';
import {
  BugHunterBoardService,
  TAB_STATUSES,
} from '../service/bug-hunter-board.service';
import { BughunterDbService } from '../service/bughunter-db.service';

/** `bughunter.bugs` and `bughunter.settings` in memory, answering the SQL by shape. */
class FakeBoardDb {
  bugs: any[] = [];
  settings = { mode: 'off', daily_run_limit: 10, updated_by: null };
  schemaPresent = true;
  failInsert = false;

  query = async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith("SELECT to_regclass('bughunter.bugs')")) {
      return [{ present: this.schemaPresent }];
    }
    if (s.startsWith('SELECT mode, daily_run_limit')) {
      const started = this.bugs.filter((b) => b.started_at).length;
      return [{ ...this.settings, updated_at: null, started_today: started }];
    }
    if (s.startsWith('UPDATE bughunter.settings SET mode')) {
      this.settings.mode = params[0];
      this.settings.updated_by = params[1];
      return [];
    }
    if (s.startsWith('SELECT id, source, app, title')) {
      const rows = this.bugs.filter((b) => params[0].includes(b.status));
      return rows
        .slice(params[2], params[2] + params[1])
        .map((b) => ({ ...b, total: rows.length }));
    }
    if (s.startsWith('SELECT status, count(*)')) {
      const counts = new Map<string, number>();
      this.bugs.forEach((b) =>
        counts.set(b.status, (counts.get(b.status) ?? 0) + 1),
      );
      return [...counts].map(([status, n]) => ({ status, n }));
    }
    if (s.startsWith('SELECT id, status, app FROM bughunter.bugs')) {
      return this.bugs.filter((b) => b.id === params[0]);
    }
    if (s.startsWith("UPDATE bughunter.bugs SET status = 'queued'")) {
      const b = this.bugs.find(
        (x) => x.id === params[0] && params[3].includes(x.status),
      );
      if (!b) return [[], 0];
      Object.assign(b, {
        status: 'queued',
        app: params[1],
        queued_by: params[2],
      });
      return [[{ id: b.id }], 1];
    }
    if (s.startsWith('INSERT INTO bughunter.bugs')) {
      if (this.failInsert) throw new Error('connection reset');
      if (this.bugs.some((b) => b.signal_key === params[0])) return [];
      this.bugs.push({
        id: this.bugs.length + 1,
        source: 'reported',
        signal_key: params[0],
        app: params[1],
        title: params[2],
        description: params[3],
        payload: JSON.parse(params[4]),
        status: 'backlog',
        created_at: new Date('2026-11-16T09:00:00Z'),
      });
      return [];
    }
    throw new Error(`unexpected SQL: ${s.slice(0, 80)}`);
  };
}

const bug = (
  id: number,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  source: 'reported',
  signal_key: `reported:${id}`,
  app: 'ally-web',
  title: `bug ${id}`,
  description: 'the save button does nothing',
  status,
  reason: null,
  report_id: null,
  run_id: null,
  attempts: 0,
  created_at: new Date(`2026-11-16T0${id}:00:00Z`),
  started_at: null,
  finished_at: null,
  ...extra,
});

describe('BugHunterBoardService', () => {
  let fake: FakeBoardDb;
  let audit: { log: jest.Mock };
  let service: BugHunterBoardService;

  beforeEach(() => {
    fake = new FakeBoardDb();
    audit = { log: jest.fn() };
    const db = { get: async () => fake } as unknown as BughunterDbService;
    service = new BugHunterBoardService(
      db,
      audit as any,
      fake as unknown as DataSource,
    );
  });

  it('maps the five tabs onto the queue statuses', () => {
    expect(TAB_STATUSES).toEqual({
      needs_you: ['needs_you'],
      failed: ['failed'],
      in_progress: ['queued', 'running'],
      backlog: ['backlog'],
      done: ['done'],
    });
  });

  it('lists one tab and counts every tab', async () => {
    fake.bugs = [
      bug(1, 'backlog'),
      bug(2, 'queued'),
      bug(3, 'running'),
      bug(4, 'needs_you', { report_id: 9 }),
      bug(5, 'failed', { reason: 'sandbox died' }),
      bug(6, 'done'),
    ];
    const out = await service.list({ tab: 'in_progress' });
    expect(out.items.map((b) => b.id)).toEqual([2, 3]);
    expect(out.counts).toEqual({
      needs_you: 1,
      failed: 1,
      in_progress: 2,
      backlog: 1,
      done: 1,
    });
    const needs = await service.list({});
    expect(needs.tab).toBe('needs_you');
    expect(needs.items[0]).toMatchObject({ id: 4, reportId: 9 });
  });

  it('switches the mode with an audit entry of before and after', async () => {
    const out = await service.setMode('autonomous', 7);
    expect(out.mode).toBe('autonomous');
    expect(audit.log).toHaveBeenCalledWith({
      eventType: 'BUG_HUNTER_V2_MODE_CHANGED',
      userId: 7,
      details: { from: 'off', to: 'autonomous' },
    });
  });

  it('Start fix queues a backlog bug, and Retry a failed one, audited', async () => {
    fake.bugs = [bug(1, 'backlog'), bug(2, 'failed')];
    await expect(service.start(1, {}, 7)).resolves.toMatchObject({
      status: 'queued',
    });
    await service.start(2, {}, 7);
    expect(fake.bugs.map((b) => b.status)).toEqual(['queued', 'queued']);
    expect(audit.log).toHaveBeenCalledWith({
      eventType: 'BUG_HUNTER_V2_BUG_STARTED',
      userId: 7,
      details: { bugId: 2, from: 'failed', app: 'ally-web' },
    });
  });

  it('refuses to start what is running, done or unknown', async () => {
    fake.bugs = [bug(1, 'running'), bug(2, 'done'), bug(3, 'needs_you')];
    await expect(service.start(1, {}, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.start(2, {}, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.start(3, {}, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.start(99, {}, 7)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a reported bug without an app needs one picked before it starts', async () => {
    fake.bugs = [bug(1, 'backlog', { app: null })];
    await expect(service.start(1, {}, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.start(1, { app: 'ally-be' }, 7);
    expect(fake.bugs[0]).toMatchObject({ status: 'queued', app: 'ally-be' });
  });

  describe('enqueueReported (the roadmap "file a bug" hook)', () => {
    it('queues a filed bug once, in the backlog, with a known app', async () => {
      const input = {
        opportunityId: 'opp-1',
        description: 'Save does nothing\nsteps: open settings, press save',
        repo: 'ally-web',
      };
      await service.enqueueReported(input);
      await service.enqueueReported(input);
      expect(fake.bugs).toHaveLength(1);
      expect(fake.bugs[0]).toMatchObject({
        signal_key: 'reported:opp-1',
        app: 'ally-web',
        title: 'Save does nothing',
        status: 'backlog',
      });
    });

    it('leaves the app empty when the classifier names no app of ours', async () => {
      await service.enqueueReported({
        opportunityId: 'opp-2',
        description: 'something is off',
        repo: 'infra',
      });
      expect(fake.bugs[0].app).toBeNull();
    });

    it('does nothing before Bug Hunter v2 is set up, and never throws', async () => {
      fake.schemaPresent = false;
      await service.enqueueReported({
        opportunityId: 'opp-3',
        description: 'x',
      });
      expect(fake.bugs).toHaveLength(0);
      fake.schemaPresent = true;
      fake.failInsert = true;
      await expect(
        service.enqueueReported({ opportunityId: 'opp-4', description: 'x' }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('board body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  it('accepts only the three modes', async () => {
    await expect(
      pipe.transform({ mode: 'ai' }, { type: 'body', metatype: UpdateModeDto }),
    ).rejects.toBeDefined();
    await expect(
      pipe.transform(
        { mode: 'manual' },
        { type: 'body', metatype: UpdateModeDto },
      ),
    ).resolves.toMatchObject({ mode: 'manual' });
  });

  it('accepts only our apps on Start fix', async () => {
    await expect(
      pipe.transform({ app: 'infra' }, { type: 'body', metatype: StartBugDto }),
    ).rejects.toBeDefined();
  });
});
