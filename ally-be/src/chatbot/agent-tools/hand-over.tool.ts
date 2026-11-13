import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HandoverService } from '../handover/handover.service';
import { ConversationService } from '../service/conversation.service';
import type {
  AgentGatewayTool,
  AgentToolContext,
  AgentToolOutcome,
} from './tools';

/** The summary is one line for the team. */
export const HAND_OVER_SUMMARY_MAX_CHARS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HandOverInput {
  summary: string;
}

/**
 * `hand_over` (chunk 3b): the agent passes the chat to a person on the team. The conversation is
 * marked Needs a person with the reason `assistant` (the first reason stays), the summary is kept
 * in its metadata (`handover.summary`, shown nowhere yet), and the inbox is told. 11a's email to
 * the owners picks it up like any other chat that needs a person.
 *
 * In Preview it changes nothing. With no stored conversation for the token's bot (WhatsApp while
 * `sharedStoreWrites` is off, or another bot's conversation) it fails: never a silent success.
 */
@Injectable()
export class HandOverTool implements AgentGatewayTool<HandOverInput> {
  readonly name = 'hand_over';

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly handover: HandoverService,
    private readonly conversations: ConversationService,
  ) {}

  parse(input: Record<string, unknown>): HandOverInput {
    const unknown = Object.keys(input).filter((key) => key !== 'summary');
    if (unknown.length) {
      throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    }
    const summary = input.summary ?? '';
    if (typeof summary !== 'string') {
      throw new BadRequestException('summary must be text');
    }
    if (summary.length > HAND_OVER_SUMMARY_MAX_CHARS) {
      throw new BadRequestException(
        `summary is at most ${HAND_OVER_SUMMARY_MAX_CHARS} characters`,
      );
    }
    return { summary };
  }

  async run(
    ctx: AgentToolContext,
    { summary }: HandOverInput,
  ): Promise<AgentToolOutcome> {
    if (ctx.conversationId.startsWith('preview-')) {
      return { ok: true, result: { preview: true } };
    }
    const [conversation] = UUID.test(ctx.conversationId)
      ? ((await this.dataSource.query(
          `SELECT id FROM chatbot_conversations WHERE id = $1 AND chatbot_id = $2`,
          [ctx.conversationId, ctx.chatbotId],
        )) as { id: string }[])
      : [];
    if (!conversation) return { ok: false, error: 'no_conversation' };

    // An empty summary still hands over; there's just nothing to keep.
    if (summary.trim()) {
      await this.conversations.setMetadata(conversation.id, {
        handover: { summary: summary.trim() },
      });
    }
    await this.handover.markNeedsPerson(
      ctx.chatbotId,
      conversation.id,
      'assistant',
    );
    return { ok: true, result: { needs_person: true } };
  }
}
