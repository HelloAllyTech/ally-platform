import { NotFoundException } from '@nestjs/common';
import { AnalyticsAgentOutcome } from '../../dto/analytics-agent.dto';
import { ANALYTICS_AGENT_CONVERSATION_TITLE_MAX } from '../../entity/analytics-agent-conversation.entity';
import {
  AnalyticsAgentConversationService,
  titleFromQuestion,
} from '../analytics-agent-conversation.service';

describe('titleFromQuestion', () => {
  it('uses the question as-is when it fits', () => {
    expect(titleFromQuestion('How many sessions last week?')).toBe(
      'How many sessions last week?',
    );
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(titleFromQuestion('  How many\n\n sessions   last week? ')).toBe(
      'How many sessions last week?',
    );
  });

  it('trims a long question to the column width, ending in an ellipsis', () => {
    const title = titleFromQuestion('a'.repeat(500));
    expect(title).toHaveLength(ANALYTICS_AGENT_CONVERSATION_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('AnalyticsAgentConversationService', () => {
  const response = {
    outcome: AnalyticsAgentOutcome.ANSWER,
    question: 'q',
  } as never;

  const build = () => {
    const manager = {
      exists: jest.fn(),
      update: jest.fn(),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      // A conversation (it has a title) and a turn get different ids.
      save: jest.fn(async (row: object) => ({
        id: 'title' in row ? 'new-conv' : 'new-message',
        ...row,
      })),
    };
    const conversations = {
      exist: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    // The ownership check for feedback is one query-builder chain ending in getExists.
    const getExists = jest.fn();
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists,
    };
    const messages = {
      find: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const dataSource = {
      transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
    };
    const service = new AnalyticsAgentConversationService(
      conversations as never,
      messages as never,
      dataSource as never,
    );
    return { service, manager, conversations, messages, queryBuilder };
  };

  it('starts a conversation titled by the question when none is given', async () => {
    const { service, manager } = build();

    const saved = await service.saveTurn(
      7,
      undefined,
      'How many users?',
      response,
    );

    expect(saved).toEqual({
      conversationId: 'new-conv',
      messageId: 'new-message',
    });
    expect(manager.create).toHaveBeenCalledWith(expect.anything(), {
      userId: 7,
      title: 'How many users?',
    });
    // conversation + one turn
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it("appends to the caller's own conversation and bumps it", async () => {
    const { service, manager } = build();
    manager.exists.mockResolvedValue(true);

    const saved = await service.saveTurn(7, 'conv-1', 'And by week?', response);

    expect(saved).toEqual({
      conversationId: 'conv-1',
      messageId: 'new-message',
    });
    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it("refuses to append to someone else's conversation", async () => {
    const { service, manager } = build();
    manager.exists.mockResolvedValue(false);

    await expect(
      service.saveTurn(7, 'conv-of-someone-else', 'q', response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("reports a conversation that is not the caller's as not found", async () => {
    const { service, conversations } = build();
    conversations.findOne.mockResolvedValue(null);

    await expect(service.get(7, 'conv-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // The lookup itself is scoped to the caller.
    expect(conversations.findOne).toHaveBeenCalledWith({
      where: { id: 'conv-1', userId: 7 },
    });
  });

  it("lists only the caller's conversations, newest activity first", async () => {
    const { service, conversations } = build();
    conversations.find.mockResolvedValue([]);

    await service.list(7);

    expect(conversations.find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { updatedAt: 'DESC' },
    });
  });

  describe('setFeedback', () => {
    it('saves a thumbs up or down on the message', async () => {
      const { service, messages, queryBuilder } = build();
      queryBuilder.getExists.mockResolvedValue(true);

      await expect(service.setFeedback(7, 'msg-1', 'down')).resolves.toEqual({
        messageId: 'msg-1',
        feedback: 'down',
      });

      expect(messages.update).toHaveBeenCalledWith(
        { id: 'msg-1' },
        { feedback: 'down' },
      );
    });

    it('withdraws a rating when given null', async () => {
      const { service, messages, queryBuilder } = build();
      queryBuilder.getExists.mockResolvedValue(true);

      await service.setFeedback(7, 'msg-1', null);

      expect(messages.update).toHaveBeenCalledWith(
        { id: 'msg-1' },
        { feedback: null },
      );
    });

    it("looks the message up through the caller's own conversations", async () => {
      const { service, queryBuilder } = build();
      queryBuilder.getExists.mockResolvedValue(true);

      await service.setFeedback(7, 'msg-1', 'up');

      expect(queryBuilder.where).toHaveBeenCalledWith('m."id" = :messageId', {
        messageId: 'msg-1',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'c."userId" = :userId',
        { userId: 7 },
      );
    });

    it("is a 404, and saves nothing, for a message that is not the caller's", async () => {
      const { service, messages, queryBuilder } = build();
      queryBuilder.getExists.mockResolvedValue(false);

      await expect(
        service.setFeedback(7, 'msg-of-someone-else', 'up'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(messages.update).not.toHaveBeenCalled();
    });
  });

  it("returns each turn's feedback, null when none was given", async () => {
    const { service, conversations, messages } = build();
    const at = new Date('2026-11-10T09:00:00.000Z');
    conversations.findOne.mockResolvedValue({
      id: 'conv-1',
      title: 't',
      createdAt: at,
      updatedAt: at,
    });
    messages.find.mockResolvedValue([
      {
        id: 'a',
        question: 'q1',
        outcome: 'answer',
        response: {},
        feedback: 'up',
        createdAt: at,
      },
      {
        id: 'b',
        question: 'q2',
        outcome: 'answer',
        response: {},
        feedback: null,
        createdAt: at,
      },
    ]);

    const detail = await service.get(7, 'conv-1');

    expect(detail.messages.map((m) => m.feedback)).toEqual(['up', null]);
  });
});
