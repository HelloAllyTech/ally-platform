import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { Chatbot } from '../entity/chatbot.entity';
import { Connector } from '../entity/connector.entity';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import {
  ConnectorRegistry,
  ConnectorSummary,
} from '../connector/connector-registry';
import { ChatbotAccessService } from './chatbot-access.service';

export interface ConnectorView {
  id: string;
  type: string;
  typeLabel: string;
  name: string;
  chatbotId: string | null;
  chatbotName: string | null;
  summary: ConnectorSummary | null;
  createdAt: Date;
}

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * Connectors and which bot each one serves.
 *
 * A connector serves at most one bot (its `chatbotId`), so binding it to another bot moves it: the
 * next message is answered by the new bot, and existing conversations stay with the bot that
 * answered them (each thread is stamped with its bot when it starts).
 */
@Injectable()
export class ConnectorService {
  private readonly logger = LoggerService.getInstance(ConnectorService.name);

  constructor(
    @InjectRepository(Connector)
    private readonly connectorRepository: Repository<Connector>,
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    private readonly registry: ConnectorRegistry,
    private readonly access: ChatbotAccessService,
  ) {}

  types() {
    return this.registry
      .list()
      .map(({ type, label, description, capabilities }) => ({
        type,
        label,
        description,
        capabilities,
      }));
  }

  /** Called by a connector type once its own connect flow has succeeded. */
  async create(input: {
    type: string;
    name: string;
    chatbotId?: string | null;
    status: string;
  }): Promise<Connector> {
    if (input.chatbotId) {
      await this.access.assert(input.chatbotId, ChatbotMemberRole.OWNER);
    } else {
      await this.access.assertPlatformAdmin();
    }
    const userId = currentUserId();
    return this.connectorRepository.save(
      this.connectorRepository.create({
        type: input.type,
        name: input.name,
        chatbotId: input.chatbotId ?? null,
        status: input.status,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /** The live bot a connector serves, or null (unbound, or the bot is archived). */
  async chatbotFor(
    connectorId: string | null | undefined,
  ): Promise<Chatbot | null> {
    if (!connectorId) return null;
    const connector = await this.connectorRepository.findOne({
      where: { id: connectorId, deletedAt: IsNull() },
      select: ['id', 'chatbotId'],
    });
    if (!connector?.chatbotId) return null;
    return this.chatbotRepository.findOne({
      where: { id: connector.chatbotId, archivedAt: IsNull() },
    });
  }

  /**
   * Connectors the caller can see: one bot's (any member), or every connector including unbound
   * ones (platform admins only — an unbound number belongs to no bot, so to no member).
   */
  async list(chatbotId?: string): Promise<ConnectorView[]> {
    if (chatbotId) {
      await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    } else {
      await this.access.assertPlatformAdmin();
    }
    const rows = await this.connectorRepository.find({
      where: {
        deletedAt: IsNull(),
        ...(chatbotId ? { chatbotId } : {}),
      },
      order: { createdAt: 'ASC' },
    });
    return this.toViews(rows);
  }

  async get(id: string): Promise<ConnectorView> {
    const row = await this.getVisible(id, ChatbotMemberRole.VIEWER);
    return (await this.toViews([row]))[0];
  }

  /**
   * Move a connector to a bot, or unbind it (`null`). The caller must own the target bot, and the
   * bot it is leaving — taking another team's number away is not something a bot owner can do.
   */
  async bind(id: string, chatbotId: string | null): Promise<ConnectorView> {
    const row = await this.getVisible(id, ChatbotMemberRole.OWNER);
    if (chatbotId) {
      await this.access.assert(chatbotId, ChatbotMemberRole.OWNER);
    }
    await this.connectorRepository.update(
      { id: row.id },
      { chatbotId, updatedBy: currentUserId() },
    );
    this.logger.info(
      `Connector ${row.id} (${row.type}) moved from ${row.chatbotId ?? 'no bot'} to ${
        chatbotId ?? 'no bot'
      }`,
    );
    return this.get(row.id);
  }

  async disconnect(id: string): Promise<void> {
    const row = await this.getVisible(id, ChatbotMemberRole.OWNER);
    await this.registry.get(row.type)?.disconnect(row.id);
    await this.connectorRepository.update(
      { id: row.id },
      { chatbotId: null, status: 'disconnected', updatedBy: currentUserId() },
    );
    await this.connectorRepository.softDelete({ id: row.id });
  }

  /** Keep the generic status in step with the type's own (called by the type). */
  async setStatus(id: string, status: string): Promise<void> {
    await this.connectorRepository.update({ id }, { status });
  }

  /**
   * A connector the caller may act on at `minRole`: platform admins any; others only one bound to
   * a bot they hold that role on. Anything else is 404.
   */
  async getVisible(id: string, minRole: ChatbotMemberRole): Promise<Connector> {
    const row = await this.connectorRepository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException('Channel not found');
    if (await this.access.isPlatformAdmin()) return row;
    if (!row.chatbotId) throw new NotFoundException('Channel not found');
    await this.access.assert(row.chatbotId, minRole);
    return row;
  }

  async summariesForBots(
    chatbotIds: string[],
  ): Promise<Map<string, ConnectorView[]>> {
    const out = new Map<string, ConnectorView[]>();
    if (!chatbotIds.length) return out;
    const rows = await this.connectorRepository.find({
      where: { chatbotId: In(chatbotIds), deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    for (const view of await this.toViews(rows)) {
      const list = out.get(view.chatbotId!) ?? [];
      list.push(view);
      out.set(view.chatbotId!, list);
    }
    return out;
  }

  private async toViews(rows: Connector[]): Promise<ConnectorView[]> {
    const byType = new Map<string, string[]>();
    for (const row of rows) {
      byType.set(row.type, [...(byType.get(row.type) ?? []), row.id]);
    }
    const summaries = new Map<string, ConnectorSummary>();
    for (const [type, ids] of byType) {
      const definition = this.registry.get(type);
      if (!definition) continue;
      for (const [id, summary] of await definition.summarise(ids)) {
        summaries.set(id, summary);
      }
    }
    const botIds = [
      ...new Set(rows.map((r) => r.chatbotId).filter(Boolean)),
    ] as string[];
    const bots = botIds.length
      ? await this.chatbotRepository.find({
          where: { id: In(botIds) },
          select: ['id', 'name'],
        })
      : [];
    const botNames = new Map(bots.map((b) => [b.id, b.name]));
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      typeLabel: this.registry.get(row.type)?.label ?? row.type,
      name: row.name,
      chatbotId: row.chatbotId ?? null,
      chatbotName: row.chatbotId ? (botNames.get(row.chatbotId) ?? null) : null,
      summary: summaries.get(row.id) ?? null,
      createdAt: row.createdAt,
    }));
  }
}
