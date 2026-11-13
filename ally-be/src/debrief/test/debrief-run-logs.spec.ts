import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { DebriefConsoleController } from '../controller/debrief-console.controller';
import { DebriefRunLogKind } from '../enum/debrief-run.enum';
import {
  DebriefRunLogsService,
  GraphLogEntry,
  promptHref,
} from '../service/debrief-run-logs.service';
import { debriefCan } from '../util/debrief-console-roles.util';

/**
 * Agent logs (`debrief_run_logs`): what every agent was sent and answered,
 * stored when the graph's answer is applied, read by the Ally team only.
 */

function repo(rows: any[] = [], opts: { first?: string | null } = {}) {
  const inserted: any[] = [];
  const qb: any = {
    insert: () => qb,
    into: () => qb,
    values: (v: any[]) => {
      inserted.push(...v);
      return qb;
    },
    orIgnore: () => qb,
    execute: async () => ({ identifiers: inserted.map((_, i) => ({ id: i })) }),
    select: () => qb,
    where: () => qb,
    getRawOne: async () => ({
      first: opts.first ?? null,
      max: rows.length ? Math.max(...rows.map((r) => r.seq)) : null,
    }),
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM debrief_runs r')) {
      return [
        {
          id: 'run-1',
          sessionId: 'sess-1',
          status: 'published',
          recipeKey: 'standard',
          releaseVersion: 5,
          language: 'en',
          costUsd: '0.09',
          seconds: 134,
          scenarioTitle: 'Exam stress, first call',
        },
      ];
    }
    if (sql.includes('prompts_versions')) {
      return [
        { code: 'debrief_writer_system', version: 3, prompt: 'Write well.' },
      ];
    }
    return [];
  });
  return {
    inserted,
    query,
    createQueryBuilder: () => qb,
    find: jest.fn(async () => rows),
    insert: jest.fn(async (row: any) => inserted.push(row)),
  };
}

const MODEL: GraphLogEntry = {
  seq: 2,
  kind: 'model',
  step: 'writer',
  round: 0,
  startedAt: '2026-11-13T08:00:00.000Z',
  ms: 15000,
  model: 'writer-m',
  fallbackModel: null,
  promptCode: 'debrief_writer_system',
  promptInlined: true,
  input: '{{system_prompt}}\n\nSESSION LANGUAGE: en\n<transcript>…',
  output: { cards: { opening: 'You stayed.' }, reasoning: 'Led with risk.' },
  tokensIn: 5320,
  tokensOut: 690,
  costUsd: 0.018,
  retries: 0,
  error: null,
  attention: false,
};
const CODE: GraphLogEntry = {
  seq: 1,
  kind: 'code',
  step: 'plan',
  startedAt: '2026-11-13T07:59:59.000Z',
  ms: 2,
  input: { learnerTurns: 8, ceilingUsd: 0.5 },
  output: { recipe: 'standard', why: 'A practice session.' },
  attention: false,
};

describe('DebriefRunLogsService.record', () => {
  it('stores every entry with its prompt version, exactly as the graph sent it', async () => {
    const r = repo();
    const svc = new DebriefRunLogsService(r as any);
    const n = await svc.record(
      { id: 'run-1', tenantId: 't-1' },
      [CODE, MODEL],
      {
        debrief_writer_system: 3,
      },
    );
    expect(n).toBe(2);
    const [plan, writer] = r.inserted;
    expect(plan).toMatchObject({
      runId: 'run-1',
      tenantId: 't-1',
      seq: 1,
      kind: DebriefRunLogKind.CODE,
      step: 'plan',
      input: { learnerTurns: 8, ceilingUsd: 0.5 },
      promptCode: null,
    });
    expect(writer).toMatchObject({
      seq: 2,
      kind: DebriefRunLogKind.MODEL,
      model: 'writer-m',
      promptCode: 'debrief_writer_system',
      promptVersion: 3,
      input: MODEL.input,
      output: MODEL.output,
      tokensIn: 5320,
      tokensOut: 690,
      costUsd: '0.018000',
      retries: 0,
    });
  });

  it('a prompt replaced for this run keeps its text in the message (no version to point at)', async () => {
    const r = repo();
    const svc = new DebriefRunLogsService(r as any);
    await svc.record({ id: 'run-1', tenantId: null }, [MODEL], {
      debrief_writer_system: { text: 'CHALLENGER TEXT' },
    });
    expect(r.inserted[0].input).toBe(
      'CHALLENGER TEXT\n\nSESSION LANGUAGE: en\n<transcript>…',
    );
    expect(r.inserted[0].promptCode).toBeNull();
  });

  it('an error marks the entry for attention', async () => {
    const r = repo();
    const svc = new DebriefRunLogsService(r as any);
    await svc.record({ id: 'run-1' }, [
      { ...MODEL, error: '502: writer returned no usable answer' },
    ]);
    expect(r.inserted[0].attention).toBe(true);
  });

  it('never fails the run when the write fails', async () => {
    const r = repo();
    r.createQueryBuilder = () => {
      throw new Error('db down');
    };
    const svc = new DebriefRunLogsService(r as any);
    await expect(svc.record({ id: 'run-1' }, [CODE])).resolves.toBe(0);
  });

  it('the independent judge is logged after the run’s entries', async () => {
    const r = repo([{ seq: 7 }]);
    const svc = new DebriefRunLogsService(r as any);
    await svc.recordJudge(
      { id: 'run-1', tenantId: 't-1' },
      {
        input: '{{system_prompt}}\n<debrief>…',
        prompt_inlined: true,
        output: { dimensions: [] },
        model: 'gemini-2.5-pro',
        tokens_in: 6210,
        tokens_out: 512,
        ms: 12400,
      },
      { code: 'debrief_quality_judge_system', version: 1 },
      'gemini-2.5-pro',
    );
    expect(r.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        seq: 8,
        step: 'judge',
        kind: DebriefRunLogKind.MODEL,
        promptCode: 'debrief_quality_judge_system',
        promptVersion: 1,
        tokensIn: 6210,
      }),
    );
  });
});

describe('DebriefRunLogsService.view', () => {
  it('returns the entries in order, each with a link to its prompt version, and the texts once', async () => {
    const r = repo(
      [
        { ...CODE, runId: 'run-1', retries: 0, attention: false },
        {
          ...MODEL,
          runId: 'run-1',
          promptVersion: 3,
          costUsd: '0.018000',
          startedAt: new Date(MODEL.startedAt as string),
        },
      ],
      { first: '2026-11-13T08:00:00Z' },
    );
    const svc = new DebriefRunLogsService(r as any);
    const v = await svc.view('run-1');
    expect(v.loggedFrom).toBe('2026-11-13');
    expect(v.run).toMatchObject({
      scenarioTitle: 'Exam stress, first call',
      releaseVersion: 5,
      costUsd: 0.09,
      seconds: 134,
    });
    expect(v.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(v.entries[1].prompt).toEqual({
      code: 'debrief_writer_system',
      version: 3,
      href: promptHref('debrief_writer_system', 3),
      inlined: true,
    });
    expect(v.entries[1].costUsd).toBe(0.018);
    expect(v.prompts).toEqual({ 'debrief_writer_system@3': 'Write well.' });
  });

  it('a run from before logs were kept: no entries, and the day they start', async () => {
    const r = repo([], { first: '2026-11-14T03:00:00Z' });
    const svc = new DebriefRunLogsService(r as any);
    const v = await svc.view('run-1');
    expect(v.entries).toEqual([]);
    expect(v.loggedFrom).toBe('2026-11-14');
    expect(v.prompts).toEqual({});
  });
});

describe('Agent logs: Ally team only', () => {
  function guardFor(perms: string[]) {
    return new PermissionsGuard(new Reflector(), {
      getUserPermissions: jest.fn(async () => perms),
    } as any);
  }
  const ctx = (handler: string): ExecutionContext =>
    ({
      getHandler: () => (DebriefConsoleController.prototype as any)[handler],
      getClass: () => DebriefConsoleController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 1 }, method: 'GET', url: '/x' }),
      }),
    }) as any;

  it('the team reads them; the clinical advisor gets 403', async () => {
    await expect(
      guardFor([PERMISSIONS.SYSTEM_ACCESS]).canActivate(ctx('agentLogsOf')),
    ).resolves.toBe(true);
    await expect(
      guardFor([PERMISSIONS.REVIEW_DEBRIEFS]).canActivate(ctx('agentLogsOf')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('`can.agentLogs` shows the button to the team only', () => {
    expect(debriefCan([PERMISSIONS.SYSTEM_ACCESS]).agentLogs).toBe(true);
    expect(debriefCan([PERMISSIONS.REVIEW_DEBRIEFS]).agentLogs).toBe(false);
  });
});

describe('Agent logs go with the session', () => {
  it('each row cascades from its run, and a run from its session', () => {
    const dir = join(__dirname, '../../database/migrations');
    const logs = readFileSync(
      join(dir, '1981901000000-CreateDebriefRunLogs.ts'),
      'utf8',
    );
    expect(logs).toMatch(
      /FOREIGN KEY \("run_id"\)\s+REFERENCES "debrief_runs"\("id"\) ON DELETE CASCADE/,
    );
    const runs = readFileSync(
      join(dir, '1980810000000-CreateDebriefRuns.ts'),
      'utf8',
    );
    expect(runs).toMatch(
      /FOREIGN KEY \("scenarioSessionId"\)\s+REFERENCES "scenario_sessions"\("id"\) ON DELETE CASCADE/,
    );
  });
});
