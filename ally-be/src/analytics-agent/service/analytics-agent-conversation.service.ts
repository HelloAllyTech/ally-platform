import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AnalyticsAgentConversationDetailDto,
  AnalyticsAgentConversationSummaryDto,
  AnalyticsAgentFeedbackResponseDto,
  AskAnalyticsAgentResponseDto,
} from '../dto/analytics-agent.dto';
import {
  ANALYTICS_AGENT_CONVERSATION_TITLE_MAX,
  AnalyticsAgentConversation,
} from '../entity/analytics-agent-conversation.entity';
import {
  AnalyticsAgentFeedback,
  AnalyticsAgentMessage,
} from '../entity/analytics-agent-message.entity';

/** The title for a thread: its first question, whitespace collapsed and trimmed to fit. */
export function titleFromQuestion(question: string): string {
  const collapsed = question.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= ANALYTICS_AGENT_CONVERSATION_TITLE_MAX) {
    return collapsed;
  }
  return `${collapsed.slice(0, ANALYTICS_AGENT_CONVERSATION_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Saved Analytics Agent conversations.
 *
 * Every method takes the caller's `userId` and filters on it. A conversation
 * that exists but belongs to someone else is reported as "not found", not
 * "forbidden" — the existence of another admin's thread is not the caller's to
 * learn.
 */
@Injectable()
export class AnalyticsAgentConversationService {
  constructor(
    @InjectRepository(AnalyticsAgentConversation)
    private readonly conversations: Repository<AnalyticsAgentConversation>,
    @InjectRepository(AnalyticsAgentMessage)
    private readonly messages: Repository<AnalyticsAgentMessage>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Throws 404 unless the conversation exists and is the caller's. Called
   * before the agent runs, so a bad id costs nothing rather than a full LLM run.
   */
  async assertOwned(userId: number, conversationId: string): Promise<void> {
    const exists = await this.conversations.exist({
      where: { id: conversationId, userId },
    });
    if (!exists) throw new NotFoundException('Conversation not found');
  }

  /**
   * Saves one answered turn. With no `conversationId` it starts a new
   * conversation titled by this question; otherwise it appends to the caller's
   * existing one. Returns the conversation id either way, and the id of the
   * saved turn — what feedback on the answer is recorded against.
   *
   * One transaction, so a turn is never saved without its conversation and a
   * conversation never appears with no turns.
   */
  async saveTurn(
    userId: number,
    conversationId: string | undefined,
    question: string,
    response: AskAnalyticsAgentResponseDto,
  ): Promise<{ conversationId: string; messageId: string }> {
    return this.dataSource.transaction(async (manager) => {
      let id = conversationId;
      if (id) {
        const owned = await manager.exists(AnalyticsAgentConversation, {
          where: { id, userId },
        });
        if (!owned) throw new NotFoundException('Conversation not found');
        await manager.update(
          AnalyticsAgentConversation,
          { id },
          { updatedAt: new Date() },
        );
      } else {
        const created = await manager.save(
          manager.create(AnalyticsAgentConversation, {
            userId,
            title: titleFromQuestion(question),
          }),
        );
        id = created.id;
      }

      const message = await manager.save(
        manager.create(AnalyticsAgentMessage, {
          conversationId: id,
          question,
          outcome: response.outcome,
          response: response as unknown as Record<string, unknown>,
        }),
      );
      return { conversationId: id, messageId: message.id };
    });
  }

  /**
   * Records, changes or (with null) withdraws the caller's thumbs up / down on
   * one answer. Only the author of the conversation can rate its answers: the
   * message is looked up through its conversation's `userId`, so another
   * admin's answer is a 404, exactly as their conversation is.
   *
   * Touches only the message row — a rating does not bump the conversation's
   * `updatedAt`, which orders the sidebar by when the thread was last used.
   */
  async setFeedback(
    userId: number,
    messageId: string,
    feedback: AnalyticsAgentFeedback | null,
  ): Promise<AnalyticsAgentFeedbackResponseDto> {
    const owned = await this.messages
      .createQueryBuilder('m')
      .innerJoin(AnalyticsAgentConversation, 'c', 'c."id" = m."conversationId"')
      .where('m."id" = :messageId', { messageId })
      .andWhere('c."userId" = :userId', { userId })
      .getExists();
    if (!owned) throw new NotFoundException('Message not found');

    await this.messages.update({ id: messageId }, { feedback });
    return { messageId, feedback };
  }

  /** The caller's conversations, most recently active first. No messages. */
  async list(userId: number): Promise<AnalyticsAgentConversationSummaryDto[]> {
    const rows = await this.conversations.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** One of the caller's conversations with every turn, oldest first. */
  async get(
    userId: number,
    conversationId: string,
  ): Promise<AnalyticsAgentConversationDetailDto> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const turns = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: turns.map((turn) => ({
        id: turn.id,
        question: turn.question,
        outcome: turn.outcome,
        response: turn.response as unknown as AskAnalyticsAgentResponseDto,
        feedback: turn.feedback ?? null,
        createdAt: turn.createdAt.toISOString(),
      })),
    };
  }
}
