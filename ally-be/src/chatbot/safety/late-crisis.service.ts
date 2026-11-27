import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import type { NotificationErrorType } from '../../notification/type/notification.error.type';
import {
  crisisLevelOf,
  type CrisisCheckResponse,
} from '../../ai/dto/knowledge.dto';
import { InboxEventsService } from '../inbox/inbox-events.service';
import { CrisisAlertService } from './crisis-alert.service';
import type { CrisisLevel } from './crisis-flag';

/** The channels whose conversations are flagged (the test console and checkups never are). */
const FLAGGED_CHANNELS = new Set(['whatsapp', 'web']);

export interface LateCrisisTurn {
  chatbot: {
    id: string;
    name: string;
    settings?: unknown;
    safetyPack?: unknown;
  };
  conversationId?: string;
  channel: { type: string };
  sender: { label: string };
}

/**
 * WA-A §0a (TF1 "Still open"): the crisis check answered after its wait, the reply had already
 * gone out (with 112 and 14416 when the message looked at risk), and the verdict was at risk. The
 * chat is flagged "May be at risk" and the team is alerted exactly as for a verdict in time: the
 * same `safety_at`, `CrisisAlertService.flag` (flag, emails, holding message, Inbox) and the Slack
 * crisis alert, and it is logged. Never throws: it runs after the reply.
 */
@Injectable()
export class LateCrisisService {
  private readonly logger = LoggerService.getInstance(LateCrisisService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crisis: CrisisAlertService,
    private readonly events: InboxEventsService,
    private readonly emitter: EventEmitter2,
  ) {}

  async flag(
    turn: LateCrisisTurn,
    verdict: CrisisCheckResponse,
  ): Promise<boolean> {
    const conversationId = turn.conversationId;
    if (!verdict?.is_crisis || !conversationId) return false;
    if (!FLAGGED_CHANNELS.has(turn.channel.type)) return false;
    try {
      const level: CrisisLevel = crisisLevelOf(verdict) === 'emergency' ? 2 : 1;
      await this.dataSource.query(
        `UPDATE chatbot_conversations SET safety_at = now() WHERE id = $1`,
        [conversationId],
      );
      await this.crisis.flag(turn.chatbot as never, conversationId, {
        level,
        path: 'classifier',
      });
      await this.events.publishInbox({
        type: 'safety',
        chatbotId: turn.chatbot.id,
        conversationId,
      });
      this.emitter.emit('exception', {
        statusCode: 200,
        timestamp: new Date().toISOString(),
        path: 'chatbot/crisis',
        message:
          `The crisis classifier fired late on chatbot "${turn.chatbot.name}" (${turn.channel.type}, ` +
          `sender ${turn.sender.label}, confidence ${Number(verdict.confidence ?? 0).toFixed(2)}, ` +
          `${level === 2 ? 'a medical emergency' : 'at risk'}). Its verdict came after the reply ` +
          `was sent, so the chat was flagged afterwards.`,
        type: 'Chatbot Crisis Classifier',
      } as NotificationErrorType);
      this.logger.warn(
        `crisis_late_verdict chatbot=${turn.chatbot.id} conversation=${conversationId} level=${level}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `A late crisis verdict could not be flagged for chatbot ${turn.chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return false;
    }
  }
}
