import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { BotPageAccessService } from '../../chatbot/bot-page/bot-page-access.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { BotPageAccessKind } from '../../chatbot/enum/bot-page.enum';
import {
  ChatbotAudienceKind,
  ChatbotMemberRole,
} from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ChatbotAudienceService } from '../../chatbot/service/chatbot-audience.service';
import { ChatbotService } from '../../chatbot/service/chatbot.service';
import {
  WaTemplateKind,
  WaTemplateMatchType,
} from '../../whatsapp/enum/whatsapp.enum';
import { WhatsAppAdminService } from '../../whatsapp/service/whatsapp-admin.service';
import { STALE_MESSAGE } from './assistant-home.service';
import {
  HOME_LISTS,
  HomeListItem,
  HomeListName,
  ListChange,
  listVersion,
  quickReplyOf,
} from './home-lists';

/**
 * The home's lists (chunk 20d-2): who can open the page, who can message on WhatsApp, the team,
 * the documents and the quick replies. Each change is one add, edit or remove, carries the version
 * of the list it was based on, and is refused with the current list when that's stale; the same
 * rule as the home's fields. The lists' own services do the work, so their checks (who may change
 * what, a bot needs an owner, a safety reply can't be switched off) apply exactly as before.
 *
 * Changes of one bot run under the bot's row lock, so the stale check and the write can't
 * interleave with another change.
 */
@Injectable()
export class HomeListsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly pages: BotPageService,
    private readonly pageAccess: BotPageAccessService,
    private readonly audience: ChatbotAudienceService,
    private readonly chatbots: ChatbotService,
    private readonly replies: WhatsAppAdminService,
  ) {}

  async read(chatbotId: string, list: HomeListName) {
    await this.access.assert(chatbotId);
    const items = await this.items(chatbotId, list);
    return {
      list,
      items,
      version: listVersion(items),
      // Lists that take an organisation offer the caller's own by name, not by id.
      ...(list === 'pageAccess' || list === 'audience'
        ? { yourOrganisation: await this.yourOrganisation() }
        : {}),
    };
  }

  private async yourOrganisation(): Promise<{
    id: string;
    name: string;
  } | null> {
    const rows: { id: string; name: string }[] = await this.dataSource.query(
      `SELECT t.id::text AS id, t.name
         FROM users u JOIN tenants t ON t.id::text = u.tenant_id
        WHERE u.id = $1
        LIMIT 1`,
      [Number(ExecutionManager.getUserId() ?? 0)],
    );
    return rows[0] ?? null;
  }

  async change(chatbotId: string, list: HomeListName, change: ListChange) {
    if (!HOME_LISTS.includes(list)) {
      throw new BadRequestException({
        errorCode: 'unknown_list',
        message: `"${list}" can't be changed here.`,
      });
    }
    await this.access.assert(
      chatbotId,
      list === 'team' ? ChatbotMemberRole.OWNER : ChatbotMemberRole.EDITOR,
    );
    return this.dataSource.transaction(async (manager) => {
      const chatbot = await manager.getRepository(Chatbot).findOne({
        where: { id: chatbotId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!chatbot) throw new NotFoundException('Chatbot not found');
      const before = await this.items(chatbotId, list);
      if (listVersion(before) !== change.version) {
        throw new ConflictException({
          errorCode: 'stale',
          message: STALE_MESSAGE,
          details: { list, items: before, version: listVersion(before) },
        });
      }
      await this.apply(chatbot, list, change, before);
      const items = await this.items(chatbotId, list);
      return { list, items, version: listVersion(items) };
    });
  }

  private async items(
    chatbotId: string,
    list: HomeListName,
  ): Promise<HomeListItem[]> {
    switch (list) {
      case 'pageAccess': {
        const page = await this.pages.findForChatbot(chatbotId);
        if (!page) return [];
        return (await this.pageAccess.list(page.id)).map((e) => ({
          id: e.id,
          kind: e.kind,
          value: e.value,
          label: e.label ?? null,
          ...(e.kind === BotPageAccessKind.ORGANISATION
            ? { organisationName: e.organisationName ?? null }
            : {}),
        }));
      }
      case 'audience':
        return (await this.audience.list(chatbotId)).map((e) => ({
          id: e.id,
          kind: e.kind,
          value: e.value,
          label: e.label ?? null,
        }));
      case 'team':
        return (await this.chatbots.listMembers(chatbotId)).map((m) => ({
          id: String(m.userId),
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
        }));
      case 'documents':
        return (await this.chatbots.listDocuments(chatbotId)).map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          private: d.private,
          isGlobal: d.isGlobal,
          archived: d.archived,
        }));
      case 'quickReplies': {
        const { templates } = await this.replies.listTemplates(
          undefined,
          false,
          chatbotId,
        );
        return templates.map((t) => quickReplyOf(t as never));
      }
    }
  }

  private async apply(
    chatbot: Chatbot,
    list: HomeListName,
    change: ListChange,
    before: HomeListItem[],
  ): Promise<void> {
    const id = chatbot.id;
    const known = (itemId?: string) => {
      const item = before.find((i) => i.id === itemId);
      if (!item) {
        throw new BadRequestException({
          errorCode: 'not_found',
          message: 'That is no longer on the list.',
          details: { list },
        });
      }
      return item;
    };
    switch (list) {
      case 'pageAccess': {
        const page = await this.pages.findForChatbot(id);
        if (!page) {
          throw new BadRequestException({
            errorCode: 'no_page',
            message: 'Choose who can use your page first, then add people.',
          });
        }
        if (change.op === 'add') {
          await this.pageAccess.add(page.id, entriesOf(change, 'page'));
          return;
        }
        if (change.op === 'remove') {
          await this.pageAccess.remove(page.id, known(change.id).id);
          return;
        }
        break;
      }
      case 'audience':
        if (change.op === 'add') {
          await this.audience.add(id, entriesOf(change, 'audience'));
          return;
        }
        if (change.op === 'remove') {
          await this.audience.remove(id, known(change.id).id);
          return;
        }
        break;
      case 'team': {
        const members = before.map((m) => ({
          userId: Number(m.userId),
          role: m.role as ChatbotMemberRole,
        }));
        if (change.op === 'add') {
          const userId = await this.userByEmail(change.item?.email);
          const role = roleOf(change.item?.role);
          await this.chatbots.setMembers(id, {
            members: [
              ...members.filter((m) => m.userId !== userId),
              { userId, role },
            ],
          });
          return;
        }
        if (change.op === 'edit') {
          const target = Number(known(change.id).userId);
          const role = roleOf(change.item?.role);
          await this.chatbots.setMembers(id, {
            members: members.map((m) =>
              m.userId === target ? { ...m, role } : m,
            ),
          });
          return;
        }
        if (change.op === 'remove') {
          const target = Number(known(change.id).userId);
          await this.chatbots.setMembers(id, {
            members: members.filter((m) => m.userId !== target),
          });
          return;
        }
        break;
      }
      case 'documents': {
        if (change.op === 'add') {
          const documentId = String(change.item?.documentId ?? '');
          const library = before.filter((d) => !d.private).map((d) => d.id);
          await this.chatbots.setDocuments(id, [...library, documentId]);
          return;
        }
        if (change.op === 'remove') {
          await this.chatbots.removeDocument(id, known(change.id).id);
          return;
        }
        break;
      }
      case 'quickReplies':
        await this.applyReply(id, change, known);
        return;
    }
    throw new BadRequestException({
      errorCode: 'unknown_op',
      message: `"${change.op}" isn't a change for this list.`,
    });
  }

  /**
   * Quick replies: the bot's own replies can be added, reworded and removed. Ally's default replies
   * (crisis, consent, commands, FAQ defaults) can only be reworded, or switched off where they're
   * optional; the WhatsApp admin service refuses switching off a required one, as it always has.
   */
  private async applyReply(
    chatbotId: string,
    change: ListChange,
    known: (id?: string) => HomeListItem,
  ): Promise<void> {
    const item = change.item ?? {};
    if (change.op === 'add') {
      await this.replies.createTemplate(
        {
          kind: WaTemplateKind.FAQ,
          name: replyText(item.name, 80, 'A name'),
          matchType: WaTemplateMatchType.ANY_OF,
          patterns: patternsOf(item.patterns),
          responseText: replyText(item.responseText, 1000, 'The reply'),
        } as never,
        chatbotId,
      );
      return;
    }
    if (change.op === 'reorder') {
      const ids = Array.isArray(change.ids) ? change.ids.map(String) : [];
      ids.forEach((reorderId) => known(reorderId));
      await this.replies.reorderTemplates({ ids } as never, chatbotId);
      return;
    }
    const reply = known(change.id);
    const own = reply.state === 'own';
    if (change.op === 'edit') {
      const dto = {
        ...(item.responseText !== undefined
          ? { responseText: replyText(item.responseText, 1000, 'The reply') }
          : {}),
        ...(item.patterns !== undefined
          ? { patterns: patternsOf(item.patterns) }
          : {}),
        ...(item.active !== undefined ? { active: Boolean(item.active) } : {}),
      };
      if (own) {
        await this.replies.updateTemplate(reply.id, dto as never, chatbotId);
      } else {
        await this.replies.customiseTemplate(
          String(reply.defaultId ?? reply.id),
          chatbotId,
          dto as never,
        );
      }
      return;
    }
    if (change.op === 'remove') {
      if (!own) {
        throw new BadRequestException({
          errorCode: 'default_reply',
          message:
            "Ally's replies can't be removed. You can reword them, or switch off the optional ones.",
        });
      }
      await this.replies.archiveTemplate(reply.id, chatbotId);
      return;
    }
    throw new BadRequestException({
      errorCode: 'unknown_op',
      message: `"${change.op}" isn't a change for this list.`,
    });
  }

  /**
   * A team member is added by the email of an Ally user in the caller's organisation (platform
   * admins, who already could add any Ally user by id, can add anyone).
   */
  private async userByEmail(raw: unknown): Promise<number> {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new BadRequestException({
        errorCode: 'invalid_value',
        message: 'Write their email address.',
      });
    }
    const anyone = await this.access.isPlatformAdmin();
    const rows: { id: number }[] = anyone
      ? await this.dataSource.query(
          `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
          [email],
        )
      : await this.dataSource.query(
          `SELECT u.id FROM users u
             JOIN users me ON me.id = $2
            WHERE lower(u.email) = $1 AND u.tenant_id = me.tenant_id
            LIMIT 1`,
          [email, Number(ExecutionManager.getUserId() ?? 0)],
        );
    if (!rows.length) {
      throw new BadRequestException({
        errorCode: 'not_a_user',
        message:
          "We couldn't find anyone in your organisation with that email.",
      });
    }
    return rows[0].id;
  }
}

function entriesOf(change: ListChange, list: 'page' | 'audience') {
  const raw = Array.isArray(change.item?.entries)
    ? (change.item!.entries as unknown[])
    : [change.item];
  const kinds: string[] =
    list === 'page'
      ? Object.values(BotPageAccessKind)
      : Object.values(ChatbotAudienceKind);
  const entries = raw.slice(0, 2000).map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const kind = String(e.kind ?? '');
    if (!kinds.includes(kind)) {
      throw new BadRequestException({
        errorCode: 'invalid_value',
        message: 'Choose an email or an organisation.',
      });
    }
    return {
      kind,
      value: String(e.value ?? ''),
      label: typeof e.label === 'string' ? e.label : undefined,
    };
  });
  if (!entries.length) {
    throw new BadRequestException({
      errorCode: 'invalid_value',
      message: 'Add at least one.',
    });
  }
  return entries as never[];
}

function roleOf(raw: unknown): ChatbotMemberRole {
  const role = Object.values(ChatbotMemberRole).find((r) => r === raw);
  if (!role) {
    throw new BadRequestException({
      errorCode: 'invalid_value',
      message: 'Choose what they can do.',
    });
  }
  return role;
}

function replyText(raw: unknown, max: number, label: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new BadRequestException({
      errorCode: 'invalid_value',
      message: `${label} can't be empty.`,
    });
  }
  if (value.length > max) {
    throw new BadRequestException({
      errorCode: 'invalid_value',
      message: `${label} can be at most ${max} characters.`,
    });
  }
  return value;
}

function patternsOf(raw: unknown): string[] {
  const words = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((w) => String(w).trim())
    .filter(Boolean);
  if (!words.length) {
    throw new BadRequestException({
      errorCode: 'invalid_value',
      message: 'Add at least one word or phrase that starts this reply.',
    });
  }
  return [...new Set(words)].slice(0, 20);
}
