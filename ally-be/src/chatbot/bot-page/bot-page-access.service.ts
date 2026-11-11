import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { UserStatus } from '../../user/constants/user-status.constants';
import { ChatbotPageAccess } from '../entity/chatbot-page-access.entity';
import { BotPageAccess, BotPageAccessKind } from '../enum/bot-page.enum';
import { ChatbotAudienceKind } from '../enum/chatbot.enum';
import { ChatbotAudienceService } from '../service/chatbot-audience.service';

export interface BotPageAccessEntryInput {
  kind: BotPageAccessKind;
  value: string;
  label?: string | null;
}

/** Who a verified email turned out to be, as far as the page's access mode is concerned. */
export interface BotPageEligibility {
  eligible: boolean;
  /** The Ally user behind the email, for organisation pages. */
  userId?: number;
  tenantId?: string;
}

/**
 * A bot page's own "who may open it" list, and the check behind organisation-only and invite-only
 * pages.
 *
 * Never consulted by the engine or by WhatsApp: `chatbot_audience` stays the only list that decides
 * who may chat on a channel, so nothing done on a page can widen that.
 */
@Injectable()
export class BotPageAccessService {
  constructor(
    @InjectRepository(ChatbotPageAccess)
    private readonly accessRepository: Repository<ChatbotPageAccess>,
    private readonly dataSource: DataSource,
  ) {}

  /** The list, with each organisation's name for the admin. */
  async list(
    pageId: string,
  ): Promise<(ChatbotPageAccess & { organisationName?: string | null })[]> {
    const entries = await this.accessRepository.find({
      where: { pageId },
      order: { kind: 'ASC', createdAt: 'ASC' },
    });
    const tenantIds = entries
      .filter((e) => e.kind === BotPageAccessKind.ORGANISATION)
      .map((e) => e.value);
    if (!tenantIds.length) return entries;
    const rows: { id: string; name: string }[] = await this.dataSource.query(
      `SELECT id::text AS id, name FROM tenants WHERE id::text = ANY($1)`,
      [tenantIds],
    );
    const names = new Map(rows.map((r) => [r.id, r.name]));
    return entries.map((e) =>
      e.kind === BotPageAccessKind.ORGANISATION
        ? { ...e, organisationName: names.get(e.value) ?? null }
        : e,
    );
  }

  /** Entries already on the list are kept as they are; returns how many were new. */
  async add(
    pageId: string,
    entries: BotPageAccessEntryInput[],
  ): Promise<{ added: number; skipped: number }> {
    if (!entries.length) return { added: 0, skipped: 0 };
    const createdBy = Number(ExecutionManager.getUserId() ?? 0) || null;
    const rows = entries.map((entry) => ({
      pageId,
      kind: entry.kind,
      value: BotPageAccessService.normaliseValue(entry.kind, entry.value),
      label: entry.label?.trim().slice(0, 120) || null,
      createdBy,
    }));
    const result = await this.accessRepository
      .createQueryBuilder()
      .insert()
      .into(ChatbotPageAccess)
      .values(rows)
      .orIgnore()
      .returning('id')
      .execute();
    const added = (result.raw as unknown[])?.length ?? 0;
    return { added, skipped: rows.length - added };
  }

  async remove(pageId: string, entryId: string): Promise<void> {
    await this.accessRepository.delete({ id: entryId, pageId });
  }

  /**
   * Whether `email` may open the page. Invite: it is on the list. Organisation: it belongs to an
   * active Ally user whose organisation is on the list. Public pages need no email.
   */
  async eligibility(
    page: { id: string; access: BotPageAccess },
    email: string,
  ): Promise<BotPageEligibility> {
    const normalised = BotPageAccessService.tryNormaliseEmail(email);
    if (!normalised) return { eligible: false };

    if (page.access === BotPageAccess.INVITE) {
      const found = await this.accessRepository.count({
        where: {
          pageId: page.id,
          kind: BotPageAccessKind.EMAIL,
          value: normalised,
        },
      });
      return { eligible: found > 0 };
    }

    if (page.access === BotPageAccess.ORGANISATION) {
      const rows: { id: number; tenant_id: string }[] =
        await this.dataSource.query(
          `SELECT u.id, u.tenant_id::text AS tenant_id
             FROM users u
             JOIN chatbot_page_access a
               ON a.page_id = $2 AND a.kind = $3 AND a.value = u.tenant_id::text
            WHERE lower(u.email) = $1 AND u.status = $4
            LIMIT 1`,
          [
            normalised,
            page.id,
            BotPageAccessKind.ORGANISATION,
            UserStatus.ACTIVE,
          ],
        );
      const user = rows[0];
      return user
        ? { eligible: true, userId: Number(user.id), tenantId: user.tenant_id }
        : { eligible: false };
    }

    return { eligible: true };
  }

  static normaliseValue(kind: BotPageAccessKind, raw: string): string {
    if (kind === BotPageAccessKind.EMAIL) {
      return ChatbotAudienceService.normaliseValue(
        ChatbotAudienceKind.EMAIL,
        raw,
      );
    }
    const value = (raw ?? '').trim();
    if (!isUUID(value)) {
      throw new BadRequestException(`"${value}" is not an organisation id.`);
    }
    return value.toLowerCase();
  }

  /** A lower-cased email, or null when it isn't one. Never throws: visitors type anything. */
  static tryNormaliseEmail(raw: string | null | undefined): string | null {
    const value = (raw ?? '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 256
      ? value
      : null;
  }
}
