import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { BuilderPlanConversationService } from '../builder-plan-conversation.service';

const SESSION = '0b9d2d7c-6a0e-4b1e-9f3a-2c1d5e6f7a8b';
const AUTHOR = 1;
const LEAD = 4;
const OTHER = 9;

function build(
  opts: { lead?: number | null; roles?: Record<number, string> } = {},
) {
  const rows: any[] = [
    {
      id: 'ask',
      seq: 1,
      role: BuilderMessageRole.ASSISTANT,
      content: 'Q',
      metadata: {
        questions: [
          {
            id: 'q1',
            prompt: 'Who first?',
            kind: 'single',
            options: [
              { id: 'o1', label: 'Learners' },
              { id: 'o2', label: 'Supervisors' },
            ],
          },
        ],
      },
      createdAt: new Date(),
    },
  ];
  const messages = {
    listBySession: jest.fn(async () => [...rows]),
    appendMessage: jest.fn(async (_s: string, m: any) => {
      const row = {
        id: `m${rows.length + 1}`,
        seq: rows.length + 1,
        createdAt: new Date(),
        ...m,
      };
      rows.push(row);
      return row;
    }),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, params: any[] = []): Promise<any> => {
      if (sql.includes('FROM "builder_sessions" s')) {
        return [
          {
            id: SESSION,
            createdBy: AUTHOR,
            leadUserId: opts.lead === undefined ? null : opts.lead,
            kind: 'plan',
            visibility: 'shared',
            itemId: 'opp-1',
            code: 'OPP-0100',
          },
        ];
      }
      if (sql.includes('FROM "users"')) return [{ name: `User ${params[0]}` }];
      if (sql.includes(`metadata->>'idempotencyKey' = $2`)) {
        return rows.filter((r) => r.metadata?.idempotencyKey === params[1]);
      }
      return [];
    }),
  };
  const deps = {
    dataSource,
    messages,
    settings: { assertRoadmapV2: jest.fn() },
    roles: {
      roleOf: jest.fn(
        async (id: number) =>
          opts.roles?.[id] ?? (id === LEAD ? 'builder' : 'idea'),
      ),
    },
    inbox: { deliver: jest.fn() },
    events: { record: jest.fn() },
    broadcast: { emit: jest.fn() },
  };
  const service = new BuilderPlanConversationService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof BuilderPlanConversationService
    >),
  );
  return { service, deps, rows };
}

describe('BuilderPlanConversationService', () => {
  it('stores an attributed answer once, however often an offline client retries', async () => {
    const { service, deps } = build();
    const first = await service.answer(SESSION, OTHER, {
      questionId: 'q1',
      optionIds: ['o1'],
      text: 'mostly week one',
      idempotencyKey: 'offline-key-1',
    });
    const again = await service.answer(SESSION, OTHER, {
      questionId: 'q1',
      optionIds: ['o1'],
      text: 'mostly week one',
      idempotencyKey: 'offline-key-1',
    });
    expect(again.post.id).toBe(first.post.id);
    expect(deps.messages.appendMessage).toHaveBeenCalledTimes(1);
    // One live update for the one stored answer, not one per retry.
    expect(deps.broadcast.emit).toHaveBeenCalledTimes(1);
    expect(deps.broadcast.emit).toHaveBeenCalledWith({
      kind: 'ITEM_CHANGED',
      actorId: OTHER,
      code: 'OPP-0100',
      fields: ['answers'],
    });
    expect(first.post).toMatchObject({
      kind: 'answer',
      text: 'Learners; mostly week one',
      by: { id: OTHER, relation: 'idea' },
    });
  });

  it('refuses an unknown question or option', async () => {
    const { service } = build();
    await expect(
      service.answer(SESSION, OTHER, {
        questionId: 'nope',
        text: 'x',
        idempotencyKey: 'key-00000001',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.answer(SESSION, OTHER, {
        questionId: 'q1',
        optionIds: ['o9'],
        idempotencyKey: 'key-00000002',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('tells the settler once when answers start to conflict', async () => {
    const { service, deps } = build();
    await service.answer(SESSION, OTHER, {
      questionId: 'q1',
      optionIds: ['o1'],
      idempotencyKey: 'key-00000003',
    });
    const second = await service.answer(SESSION, AUTHOR, {
      questionId: 'q1',
      optionIds: ['o2'],
      idempotencyKey: 'key-00000004',
    });
    expect(second.question.conflict).toBe(true);
    expect(second.question.settler).toMatchObject({ id: AUTHOR });
    expect(deps.inbox.deliver).toHaveBeenCalledTimes(1);
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: RoadmapNotificationKind.ANSWERS_CONFLICT,
      }),
    );
    expect(
      deps.dataSource.query.mock.calls.some(
        ([sql, p]) => String(sql).includes('openConflicts') && p?.[1] === 1,
      ),
    ).toBe(true);
  });

  it('the author settles before there is a lead; the choice is a decision', async () => {
    const { service, deps } = build();
    const a = await service.answer(SESSION, OTHER, {
      questionId: 'q1',
      optionIds: ['o1'],
      idempotencyKey: 'key-00000005',
    });
    await service.answer(SESSION, AUTHOR, {
      questionId: 'q1',
      optionIds: ['o2'],
      idempotencyKey: 'key-00000006',
    });
    await expect(
      service.settle(SESSION, OTHER, a.post.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const { question } = await service.settle(SESSION, AUTHOR, a.post.id);
    expect(question).toMatchObject({
      conflict: false,
      chosenPostId: a.post.id,
    });
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: PlanEventKind.ANSWER_SETTLED }),
    );
    expect(deps.broadcast.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['answers'], actorId: AUTHOR }),
    );
  });

  it('once there is a lead, the author no longer settles', async () => {
    const { service } = build({ lead: LEAD });
    const a = await service.answer(SESSION, OTHER, {
      questionId: 'q1',
      optionIds: ['o1'],
      idempotencyKey: 'key-00000007',
    });
    await expect(service.settle(SESSION, AUTHOR, a.post.id)).rejects.toThrow(
      /lead/,
    );
    await expect(
      service.settle(SESSION, LEAD, a.post.id),
    ).resolves.toBeDefined();
  });

  it('a comment @mentions people once; a Viewer may comment, no role may not', async () => {
    const { service, deps } = build({ roles: { 8: 'viewer', 99: 'none' } });
    await service.comment(SESSION, 8, {
      text: 'Ravi, see the analytics',
      mentionUserIds: [AUTHOR, 8],
      idempotencyKey: 'key-00000008',
    });
    await service.comment(SESSION, 8, {
      text: 'Ravi, see the analytics',
      mentionUserIds: [AUTHOR],
      idempotencyKey: 'key-00000008',
    });
    expect(deps.broadcast.emit).toHaveBeenCalledTimes(1);
    expect(deps.broadcast.emit).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ['comments'], code: 'OPP-0100' }),
    );
    expect(deps.inbox.deliver).toHaveBeenCalledTimes(1);
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: RoadmapNotificationKind.MENTION,
        directRecipientIds: [AUTHOR],
      }),
    );
    await expect(
      service.comment(SESSION, 99, {
        text: 'x',
        idempotencyKey: 'key-00000009',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
