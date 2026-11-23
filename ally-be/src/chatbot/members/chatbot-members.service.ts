import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';
import {
  legacyRole,
  normaliseRoles,
  rolesFromInput,
  rolesOfRow,
} from '../access/chatbot-roles';
import { InboxEventsService } from '../inbox/inbox-events.service';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { MEMBER_COPY } from './members.copy';

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/** One member as the team list shows it. `role` is the OLD single role, `roles` the set. */
export interface ChatbotMemberView {
  userId: number;
  name: string | null;
  email: string | null;
  role: ChatbotMemberRole;
  roles: ChatbotMemberRole[];
  /** `chatbots.created_by`: can't be removed or leave until ownership is transferred. */
  isCreator: boolean;
}

export interface MemberInput {
  userId: number;
  role?: ChatbotMemberRole;
  roles?: ChatbotMemberRole[];
}

/** The member-change refusals, as `errorCode` in the 4xx body. */
export const MEMBER_ERROR = {
  LAST_OWNER: 'last_owner',
  CREATOR_MUST_TRANSFER: 'creator_must_transfer',
  ONLY_CREATOR_CAN_TRANSFER: 'only_creator_can_transfer',
  NOT_A_MEMBER: 'not_a_member',
  INVALID_ROLES: 'invalid_roles',
  NOT_A_USER: 'not_a_user',
} as const;

interface LockedBot {
  id: string;
  created_by: number | null;
  archived_at: Date | null;
}

interface MemberRow {
  user_id: number;
  role: string;
  roles: string[] | string | null;
}

const conflict = (errorCode: string, message: string) =>
  new ConflictException({ errorCode, message });

/**
 * A bot's team (Stage 1b): roles as a set, dual-written to the old `role` column; the last owner
 * and the creator kept; leaving; transferring the creator-owner. Every change locks the bot's row
 * first (`SELECT … FOR UPDATE`), so two owners removing each other at once can't leave it with
 * none: the second waits for the first and then sees one owner left.
 */
@Injectable()
export class ChatbotMembersService {
  private readonly logger = LoggerService.getInstance(
    ChatbotMembersService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly events?: InboxEventsService,
  ) {}

  async list(chatbotId: string): Promise<ChatbotMemberView[]> {
    await this.access.assert(chatbotId);
    return this.read(this.dataSource.manager, chatbotId);
  }

  /** Replace the whole team (`PUT :id/members`, and the home's team list through `manager`). */
  async set(
    chatbotId: string,
    members: MemberInput[],
    manager?: EntityManager,
  ): Promise<ChatbotMemberView[]> {
    await this.access.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE);
    const wanted = new Map<number, ChatbotMemberRole[]>();
    for (const member of members) {
      const roles = rolesFromInput(member);
      if (!roles.length) {
        throw new BadRequestException({
          errorCode: MEMBER_ERROR.INVALID_ROLES,
          message: MEMBER_COPY.invalidRoles,
        });
      }
      wanted.set(Number(member.userId), roles);
    }
    const userIds = [...wanted.keys()];
    if (userIds.length) {
      const found = await (manager ?? this.dataSource.manager).query<
        { id: number }[]
      >(`SELECT id FROM users WHERE id = ANY($1::int[])`, [userIds]);
      if (found.length !== userIds.length) {
        throw new BadRequestException({
          errorCode: MEMBER_ERROR.NOT_A_USER,
          message: 'Some of those people are not Ally users.',
        });
      }
    }
    if (
      ![...wanted.values()].some((r) => r.includes(ChatbotMemberRole.OWNER))
    ) {
      throw new BadRequestException({
        errorCode: MEMBER_ERROR.LAST_OWNER,
        message: 'A chatbot needs at least one owner.',
      });
    }
    const actor = currentUserId();
    const removed = await this.inTransaction(manager, async (m) => {
      const bot = await this.lock(m, chatbotId);
      const before = await this.rows(m, chatbotId);
      const creator = bot.created_by;
      if (
        creator &&
        before.some((r) => r.user_id === creator) &&
        !wanted.get(creator)?.includes(ChatbotMemberRole.OWNER)
      ) {
        throw conflict(
          MEMBER_ERROR.CREATOR_MUST_TRANSFER,
          MEMBER_COPY.creatorMustTransfer,
        );
      }
      await m.query(`DELETE FROM chatbot_members WHERE chatbot_id = $1`, [
        chatbotId,
      ]);
      for (const [userId, roles] of wanted) {
        await this.insert(m, chatbotId, userId, roles, actor);
      }
      return before.map((r) => r.user_id).filter((id) => !wanted.has(id));
    });
    await this.afterRemoved(chatbotId, removed);
    return this.read(manager ?? this.dataSource.manager, chatbotId);
  }

  /** An owner takes one person off the team. Never the last owner, never the creator. */
  async remove(chatbotId: string, userId: number): Promise<{ removed: true }> {
    await this.access.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE);
    await this.dataSource.transaction(async (m) => {
      const bot = await this.lock(m, chatbotId);
      await this.assertMayGo(m, bot, userId, false);
      await m.query(
        `DELETE FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
        [chatbotId, userId],
      );
    });
    await this.afterRemoved(chatbotId, [userId]);
    return { removed: true };
  }

  /** The caller takes themselves off the team. The last owner and the creator can't. */
  async leave(chatbotId: string): Promise<{ left: true }> {
    const userId = currentUserId();
    // Any member may leave, an archived bot's too.
    await this.access.assertCan(chatbotId, ChatbotCapability.VIEW, userId);
    await this.dataSource.transaction(async (m) => {
      const bot = await this.lock(m, chatbotId);
      await this.assertMayGo(m, bot, userId, true);
      await m.query(
        `DELETE FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
        [chatbotId, userId],
      );
    });
    await this.afterRemoved(chatbotId, [userId]);
    return { left: true };
  }

  /**
   * The creator hands the bot to another member: they become an owner and the creator
   * (`chatbots.created_by`, which also decides who pays for it). Only the creator may, unless the
   * creator is no longer on the team, when any owner may. After it, the old creator can leave or
   * be removed like any owner.
   *
   * TODO(stage 6): refuse when the receiving account's free balance can't take the bot's budget.
   */
  async transfer(
    chatbotId: string,
    toUserId: number,
  ): Promise<ChatbotMemberView[]> {
    const actor = currentUserId();
    await this.access.assertCan(
      chatbotId,
      ChatbotCapability.MANAGE_PEOPLE,
      actor,
    );
    await this.dataSource.transaction(async (m) => {
      const bot = await this.lock(m, chatbotId);
      const rows = await this.rows(m, chatbotId);
      const creatorOnTeam =
        bot.created_by != null &&
        rows.some((r) => r.user_id === bot.created_by);
      if (creatorOnTeam && bot.created_by !== actor) {
        throw new ForbiddenException({
          errorCode: MEMBER_ERROR.ONLY_CREATOR_CAN_TRANSFER,
          message: MEMBER_COPY.onlyCreatorCanTransfer,
        });
      }
      const target = rows.find((r) => r.user_id === toUserId);
      if (!target) {
        throw new BadRequestException({
          errorCode: MEMBER_ERROR.NOT_A_MEMBER,
          message: MEMBER_COPY.transferNotAMember,
        });
      }
      const roles = normaliseRoles([
        ...rolesOfRow(target),
        ChatbotMemberRole.OWNER,
      ]);
      await m.query(
        `UPDATE chatbot_members SET roles = $3::text[], role = $4, "updatedAt" = now()
          WHERE chatbot_id = $1 AND user_id = $2`,
        [chatbotId, toUserId, roles, legacyRole(roles)],
      );
      await m.query(
        `UPDATE chatbots SET created_by = $2, updated_by = $3, "updatedAt" = now() WHERE id = $1`,
        [chatbotId, toUserId, actor || null],
      );
    });
    this.logger.info(`Chatbot ${chatbotId}: creator moved to user ${toUserId}`);
    return this.read(this.dataSource.manager, chatbotId);
  }

  /**
   * Add `roles` to a person (an accepted invite): merged into what they hold, so an invite never
   * takes a role away. Runs in the caller's transaction, under the bot's row lock.
   */
  async grant(
    m: EntityManager,
    chatbotId: string,
    userId: number,
    roles: ChatbotMemberRole[],
    createdBy: number | null,
  ): Promise<ChatbotMemberRole[]> {
    await this.lock(m, chatbotId);
    const [row] = await m.query<MemberRow[]>(
      `SELECT user_id, role, roles FROM chatbot_members WHERE chatbot_id = $1 AND user_id = $2`,
      [chatbotId, userId],
    );
    const merged = normaliseRoles([...(row ? rolesOfRow(row) : []), ...roles]);
    if (row) {
      await m.query(
        `UPDATE chatbot_members SET roles = $3::text[], role = $4, "updatedAt" = now()
          WHERE chatbot_id = $1 AND user_id = $2`,
        [chatbotId, userId, merged, legacyRole(merged)],
      );
    } else {
      await this.insert(m, chatbotId, userId, merged, createdBy);
    }
    return merged;
  }

  /** Lock the bot's row for a member change. 404 for a bot that doesn't exist. */
  async lock(m: EntityManager, chatbotId: string): Promise<LockedBot> {
    const [bot] = await m.query<LockedBot[]>(
      `SELECT id, created_by, archived_at FROM chatbots WHERE id = $1 FOR UPDATE`,
      [chatbotId],
    );
    if (!bot) throw new NotFoundException('Chatbot not found');
    return bot;
  }

  // ─────────────────────────────────────────────────────────── internals

  private async assertMayGo(
    m: EntityManager,
    bot: LockedBot,
    userId: number,
    self: boolean,
  ): Promise<void> {
    const rows = await this.rows(m, bot.id);
    const row = rows.find((r) => r.user_id === userId);
    if (!row) {
      throw new NotFoundException({
        errorCode: MEMBER_ERROR.NOT_A_MEMBER,
        message: MEMBER_COPY.notAMember,
      });
    }
    if (bot.created_by != null && bot.created_by === userId) {
      throw conflict(
        MEMBER_ERROR.CREATOR_MUST_TRANSFER,
        self ? MEMBER_COPY.creatorCantLeave : MEMBER_COPY.creatorMustTransfer,
      );
    }
    const owners = rows.filter((r) =>
      rolesOfRow(r).includes(ChatbotMemberRole.OWNER),
    );
    if (
      rolesOfRow(row).includes(ChatbotMemberRole.OWNER) &&
      owners.length <= 1
    ) {
      throw conflict(
        MEMBER_ERROR.LAST_OWNER,
        self ? MEMBER_COPY.lastOwnerCantLeave : MEMBER_COPY.lastOwner,
      );
    }
  }

  private async insert(
    m: EntityManager,
    chatbotId: string,
    userId: number,
    roles: ChatbotMemberRole[],
    createdBy: number | null,
  ): Promise<void> {
    // Dual write: the set, and the old single role an old instance reads.
    await m.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles, created_by)
       VALUES ($1, $2, $3, $4::text[], $5)`,
      [chatbotId, userId, legacyRole(roles), roles, createdBy || null],
    );
  }

  private rows(m: EntityManager, chatbotId: string): Promise<MemberRow[]> {
    return m.query<MemberRow[]>(
      `SELECT user_id, role, roles FROM chatbot_members WHERE chatbot_id = $1`,
      [chatbotId],
    );
  }

  private async read(
    m: EntityManager,
    chatbotId: string,
  ): Promise<ChatbotMemberView[]> {
    const rows = await m.query<
      (MemberRow & {
        name: string | null;
        email: string | null;
        created_by: number | null;
      })[]
    >(
      `SELECT m.user_id, m.role, m.roles, u.name, u.email, b.created_by
         FROM chatbot_members m
         JOIN chatbots b ON b.id = m.chatbot_id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.chatbot_id = $1
        ORDER BY u.name NULLS LAST`,
      [chatbotId],
    );
    return rows.map((r) => {
      const roles = rolesOfRow(r);
      return {
        userId: Number(r.user_id),
        name: r.name,
        email: r.email,
        role: legacyRole(roles),
        roles,
        isCreator: r.created_by != null && r.created_by === r.user_id,
      };
    });
  }

  private inTransaction<T>(
    manager: EntityManager | undefined,
    run: (m: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager?.queryRunner?.isTransactionActive) return run(manager);
    return (manager ?? this.dataSource.manager).transaction(run);
  }

  /**
   * After people leave a team: the chats they held go back to the assistant and are marked as
   * needing a person, their open inbox streams re-read their bots now, and their cached roles are
   * dropped. An invited-only account (ASSISTANT_MEMBER and nothing else) left on no team is signed
   * out everywhere: its refresh tokens are deleted. Every member route re-reads membership from
   * the database, so access ends with the removal itself; this is the clean-up around it.
   */
  async afterRemoved(chatbotId: string, userIds: number[]): Promise<void> {
    if (!userIds.length) return;
    try {
      const released = await this.dataSource.query<{ id: string }[]>(
        `UPDATE chatbot_conversations
            SET handled_by_user_id = NULL, handled_since = NULL,
                needs_person_since = COALESCE(needs_person_since, now())
          WHERE chatbot_id = $1 AND handled_by_user_id = ANY($2::int[])
          RETURNING id`,
        [chatbotId, userIds],
      );
      for (const row of releasedRows(released)) {
        await this.events?.publishInbox({
          type: 'state',
          chatbotId,
          conversationId: row.id,
          state: 'needs_person',
        });
        await this.events?.publishVisitor(row.id, {
          type: 'state',
          by: 'assistant',
        });
      }
      await this.events?.publishInbox({
        type: 'members',
        chatbotId,
        conversationId: '',
        removedUserIds: userIds,
      });
      for (const userId of userIds) {
        await this.redis?.del(`user:groups:${userId}`);
        await this.redis?.del(`user:roles:${userId}`);
      }
      const signOut = await this.dataSource.query<{ id: number }[]>(
        `SELECT u.id FROM users u
          WHERE u.id = ANY($1::int[])
            AND NOT EXISTS (SELECT 1 FROM chatbot_members m WHERE m.user_id = u.id)
            AND EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                         WHERE ug."userId" = u.id AND g.name = 'ASSISTANT_MEMBER')
            AND NOT EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                             WHERE ug."userId" = u.id AND g.name <> 'ASSISTANT_MEMBER')`,
        [userIds],
      );
      for (const { id } of signOut) {
        await this.dataSource.query(
          `DELETE FROM refresh_token WHERE "userId" = $1`,
          [id],
        );
      }
    } catch (error) {
      // The removal itself is done; this is clean-up, so it must not undo or fail it.
      this.logger.warn(
        `Member clean-up for chatbot ${chatbotId} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

/** A raw UPDATE … RETURNING through TypeORM is `[rows, count]` on Postgres. */
function releasedRows(result: unknown): { id: string }[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as { id: string }[];
  }
  return Array.isArray(result) ? (result as { id: string }[]) : [];
}
