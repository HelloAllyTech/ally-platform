import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';
import { normaliseRoles } from '../access/chatbot-roles';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { ChatbotMembersService } from './chatbot-members.service';
import { INVITE_COPY } from './members.copy';
import {
  CHATBOT_INVITE_CREATED_EVENT,
  type ChatbotInviteCreatedEvent,
} from '../../notification/type/chatbot-invite.event';

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/** How long an invite link works. */
export const INVITE_TTL_DAYS = 7;
/** Pending invites one chatbot may have at once. */
export const MAX_PENDING_INVITES = 200;

/**
 * Roles that already sign in to the admin portal. An invited existing account holding none of
 * these is given ASSISTANT_MEMBER on acceptance so it can sign in (a learner, say). Mirrors the
 * dashboard's ADMIN_PORTAL_LOGIN_ROLES.
 */
export const ADMIN_PORTAL_ROLES: string[] = [
  UserRole.PLATFORM_ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
  UserRole.MULTI_TENANT_ADMIN,
  UserRole.ASSISTANT_OWNER,
  UserRole.ASSISTANT_MEMBER,
];

export const INVITE_ERROR = {
  NOT_FOUND: 'invite_not_found',
  WRONG_EMAIL: 'invite_wrong_email',
  PLATFORM_ADMIN: 'invite_platform_admin',
  ALREADY_MEMBER: 'already_member',
  TOO_MANY: 'too_many_invites',
  INVALID_ROLES: 'invalid_roles',
} as const;

export interface ChatbotInviteView {
  id: string;
  email: string;
  roles: ChatbotMemberRole[];
  invitedBy: number | null;
  expiresAt: Date;
  createdAt: Date;
}

interface InviteRow {
  id: string;
  chatbot_id: string;
  email: string;
  roles: string[];
  invited_by: number | null;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_user_id: number | null;
  revoked_at: Date | null;
  createdAt: Date;
}

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token.trim()).digest('hex');

export const normaliseEmail = (email: string): string =>
  email.trim().toLowerCase();

/** `a***@example.com`: enough for the person to recognise, not to read the address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Invites to a chatbot's team (Stage 1b, D9).
 *
 * An invite is bound to its email. The token in the email proves the link came from that inbox,
 * but a link can be forwarded, so accepting also needs the email: the signed-in caller's own
 * account email, or (on the public page) the address typed in. Either way the membership goes to
 * the account OF THE INVITED EMAIL, never to whoever holds the link, and an account with that
 * email still has to sign in with a code sent to it.
 *
 * - The email has an account: access is added to it, in whatever organisation it is in, unless
 *   it is a platform admin (refused).
 * - No account: one is made in the inviter's organisation with the ASSISTANT_MEMBER role.
 */
@Injectable()
export class ChatbotInvitesService {
  private readonly logger = LoggerService.getInstance(
    ChatbotInvitesService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly members: ChatbotMembersService,
    private readonly config: AppConfigService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async create(
    chatbotId: string,
    input: { email: string; roles: ChatbotMemberRole[] },
    now = new Date(),
  ): Promise<ChatbotInviteView & { emailSent: boolean }> {
    const { chatbot } = await this.access.assertCan(
      chatbotId,
      ChatbotCapability.MANAGE_PEOPLE,
    );
    const email = normaliseEmail(input.email);
    const roles = normaliseRoles(input.roles ?? []);
    if (!roles.length) {
      throw new BadRequestException({
        errorCode: INVITE_ERROR.INVALID_ROLES,
        message: 'Choose at least one role.',
      });
    }
    const existing = await this.accountByEmail(this.dataSource.manager, email);
    if (existing && (await this.access.isPlatformAdmin(existing.id))) {
      throw new BadRequestException({
        errorCode: INVITE_ERROR.PLATFORM_ADMIN,
        message: INVITE_COPY.platformAdmin,
      });
    }
    if (
      existing &&
      (await this.access.rolesOn(chatbotId, existing.id)).length
    ) {
      throw new ConflictException({
        errorCode: INVITE_ERROR.ALREADY_MEMBER,
        message: INVITE_COPY.alreadyMember,
      });
    }

    const inviter = currentUserId();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
    const row = await this.dataSource.transaction(async (m) => {
      await this.members.lock(m, chatbotId);
      const [{ n }] = await m.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM chatbot_invites
          WHERE chatbot_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [chatbotId],
      );
      if (Number(n) >= MAX_PENDING_INVITES) {
        throw new BadRequestException({
          errorCode: INVITE_ERROR.TOO_MANY,
          message: `A chatbot can have ${MAX_PENDING_INVITES} invites waiting at once. Withdraw some first.`,
        });
      }
      // A new invite to the same email replaces the one still waiting (a resend).
      await m.query(
        `UPDATE chatbot_invites SET revoked_at = now(), revoked_by = $3, "updatedAt" = now()
          WHERE chatbot_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [chatbotId, email, inviter || null],
      );
      const [inserted] = await m.query<InviteRow[]>(
        `INSERT INTO chatbot_invites (chatbot_id, email, roles, invited_by, token_hash, expires_at)
         VALUES ($1, $2, $3::text[], $4, $5, $6)
         RETURNING id, chatbot_id, email, roles, invited_by, expires_at, accepted_at,
                   accepted_user_id, revoked_at, "createdAt"`,
        [
          chatbotId,
          email,
          roles,
          inviter || null,
          hashInviteToken(token),
          expiresAt,
        ],
      );
      return inserted;
    });

    const emailSent = await this.sendEmail({
      to: email,
      chatbotName: chatbot.name,
      inviterName: await this.nameOf(inviter),
      roles,
      link: this.linkFor(token),
      days: INVITE_TTL_DAYS,
    });
    this.logger.info(
      `Chatbot ${chatbotId}: invite ${row.id} created (email ${emailSent ? 'sent' : 'NOT sent'})`,
    );
    return { ...toView(row), emailSent };
  }

  async listPending(chatbotId: string): Promise<ChatbotInviteView[]> {
    await this.access.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE);
    const rows = await this.dataSource.query<InviteRow[]>(
      `SELECT id, chatbot_id, email, roles, invited_by, expires_at, accepted_at,
              accepted_user_id, revoked_at, "createdAt"
         FROM chatbot_invites
        WHERE chatbot_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY "createdAt" DESC`,
      [chatbotId],
    );
    return rows.map(toView);
  }

  async revoke(
    chatbotId: string,
    inviteId: string,
  ): Promise<{ revoked: true }> {
    await this.access.assertCan(chatbotId, ChatbotCapability.MANAGE_PEOPLE);
    const result = await this.dataSource.query(
      `UPDATE chatbot_invites SET revoked_at = now(), revoked_by = $3, "updatedAt" = now()
        WHERE id = $1 AND chatbot_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [inviteId, chatbotId, currentUserId() || null],
    );
    if (!affected(result)) {
      throw new NotFoundException({
        errorCode: INVITE_ERROR.NOT_FOUND,
        message: INVITE_COPY.notFound,
      });
    }
    return { revoked: true };
  }

  /** What the invite page shows before accepting. The same 404 for unknown, used, gone. */
  async preview(token: string, now = new Date()) {
    const invite = await this.findPending(this.dataSource.manager, token, now);
    const [bot] = await this.dataSource.query<{ name: string }[]>(
      `SELECT name FROM chatbots WHERE id = $1 AND archived_at IS NULL`,
      [invite.chatbot_id],
    );
    if (!bot) throw notFound();
    return {
      chatbotName: bot.name,
      email: maskEmail(invite.email),
      roles: normaliseRoles(invite.roles),
      expiresAt: invite.expires_at,
    };
  }

  /**
   * Accept an invite. `signedInUserId`: the caller is signed in, and their account's email must be
   * the invite's. Otherwise `email` (typed on the public page) must be. The membership always goes
   * to the account of the invited email.
   */
  async accept(
    token: string,
    claimant: { signedInUserId?: number; email?: string },
    now = new Date(),
  ): Promise<{
    chatbotId: string;
    chatbotName: string;
    roles: ChatbotMemberRole[];
    accountCreated: boolean;
    email: string;
  }> {
    const result = await this.dataSource.transaction(async (m) => {
      const invite = await this.findPending(m, token, now, true);
      let claimed: string | null = null;
      if (claimant.signedInUserId) {
        const [me] = await m.query<{ email: string }[]>(
          `SELECT email FROM users WHERE id = $1`,
          [claimant.signedInUserId],
        );
        claimed = me ? normaliseEmail(me.email) : null;
      } else if (claimant.email) {
        claimed = normaliseEmail(claimant.email);
      }
      if (claimed !== invite.email) {
        throw new ForbiddenException({
          errorCode: INVITE_ERROR.WRONG_EMAIL,
          message: INVITE_COPY.wrongEmail,
        });
      }
      const [bot] = await m.query<{ name: string; archived_at: Date | null }[]>(
        `SELECT name, archived_at FROM chatbots WHERE id = $1`,
        [invite.chatbot_id],
      );
      if (!bot || bot.archived_at) throw notFound();

      let account = await this.accountByEmail(m, invite.email);
      let accountCreated = false;
      if (account && (await this.access.isPlatformAdmin(account.id))) {
        throw new ForbiddenException({
          errorCode: INVITE_ERROR.PLATFORM_ADMIN,
          message: INVITE_COPY.platformAdmin,
        });
      }
      if (!account) {
        account = await this.createMemberAccount(m, invite);
        accountCreated = true;
      }
      await this.ensurePortalLogin(m, account.id);
      const roles = await this.members.grant(
        m,
        invite.chatbot_id,
        account.id,
        normaliseRoles(invite.roles),
        invite.invited_by,
      );
      await m.query(
        `UPDATE chatbot_invites SET accepted_at = now(), accepted_user_id = $2, "updatedAt" = now()
          WHERE id = $1`,
        [invite.id, account.id],
      );
      return {
        chatbotId: invite.chatbot_id,
        chatbotName: bot.name,
        roles,
        accountCreated,
        email: invite.email,
        userId: account.id,
      };
    });
    await this.redis?.del(`user:groups:${result.userId}`);
    await this.redis?.del(`user:roles:${result.userId}`);
    this.logger.info(
      `Chatbot ${result.chatbotId}: invite accepted by user ${result.userId}${result.accountCreated ? ' (new account)' : ''}`,
    );
    return {
      chatbotId: result.chatbotId,
      chatbotName: result.chatbotName,
      roles: result.roles,
      accountCreated: result.accountCreated,
      email: result.email,
    };
  }

  // ─────────────────────────────────────────────────────────── internals

  private async findPending(
    m: EntityManager,
    token: string,
    now: Date,
    lock = false,
  ): Promise<InviteRow> {
    const [invite] = await m.query<InviteRow[]>(
      `SELECT id, chatbot_id, email, roles, invited_by, expires_at, accepted_at,
              accepted_user_id, revoked_at, "createdAt"
         FROM chatbot_invites WHERE token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [hashInviteToken(String(token ?? ''))],
    );
    if (
      !invite ||
      invite.accepted_at ||
      invite.revoked_at ||
      new Date(invite.expires_at).getTime() <= now.getTime()
    ) {
      throw notFound();
    }
    return { ...invite, roles: normaliseRoles(pgArray(invite.roles)) };
  }

  private async accountByEmail(
    m: EntityManager,
    email: string,
  ): Promise<{ id: number; tenant_id: string } | null> {
    const [row] = await m.query<{ id: number; tenant_id: string }[]>(
      `SELECT id, tenant_id FROM users WHERE lower(email) = $1 ORDER BY id LIMIT 1`,
      [email],
    );
    return row ? { id: Number(row.id), tenant_id: row.tenant_id } : null;
  }

  /** A new limited account in the inviter's organisation (D9). */
  private async createMemberAccount(
    m: EntityManager,
    invite: InviteRow,
  ): Promise<{ id: number; tenant_id: string }> {
    const [inviter] = await m.query<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM users WHERE id = $1`,
      [invite.invited_by],
    );
    if (!inviter?.tenant_id) throw notFound();
    const [created] = await m.query<{ id: number }[]>(
      `INSERT INTO users (email, name, username, status, tenant_id, "profileCompleted", metadata)
       VALUES ($1, '', $1, 'ACTIVE', $2, false, $3::jsonb)
       RETURNING id`,
      [
        invite.email,
        inviter.tenant_id,
        JSON.stringify({ source: 'chatbot-invite', inviteId: invite.id }),
      ],
    );
    return { id: Number(created.id), tenant_id: inviter.tenant_id };
  }

  /** Give ASSISTANT_MEMBER to an account that can't otherwise sign in to the admin portal. */
  private async ensurePortalLogin(m: EntityManager, userId: number) {
    const groups = await m.query<{ name: string }[]>(
      `SELECT g.name FROM user_groups ug JOIN groups g ON g.id = ug."groupId" WHERE ug."userId" = $1`,
      [userId],
    );
    if (groups.some((g) => ADMIN_PORTAL_ROLES.includes(g.name))) return;
    await m.query(
      `INSERT INTO user_groups ("userId", "groupId")
       SELECT $1, g.id FROM groups g WHERE g.name = $2
          AND NOT EXISTS (SELECT 1 FROM user_groups e WHERE e."userId" = $1 AND e."groupId" = g.id)`,
      [userId, UserRole.ASSISTANT_MEMBER],
    );
  }

  private async nameOf(userId: number): Promise<string> {
    if (!userId) return 'Someone';
    const [row] = await this.dataSource.query<{ name: string | null }[]>(
      `SELECT name FROM users WHERE id = $1`,
      [userId],
    );
    return row?.name?.trim() || 'Someone';
  }

  private linkFor(token: string): string {
    const base = (this.config.adminBaseUrl ?? '').replace(/\/$/, '');
    return `${base}/assistant-invite?token=${encodeURIComponent(token)}`;
  }

  /** Through the notification module (EmailService). False when no listener sent it. */
  private async sendEmail(event: ChatbotInviteCreatedEvent): Promise<boolean> {
    if (!this.events) return false;
    try {
      const results = await this.events.emitAsync(
        CHATBOT_INVITE_CREATED_EVENT,
        event,
      );
      return results.length > 0 && results.every((r) => r !== false);
    } catch (error) {
      this.logger.warn(
        `Invite email not sent: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }
}

function toView(row: InviteRow): ChatbotInviteView {
  return {
    id: row.id,
    email: row.email,
    roles: normaliseRoles(pgArray(row.roles)),
    invitedBy: row.invited_by ?? null,
    expiresAt: row.expires_at,
    createdAt: row.createdAt,
  };
}

function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.startsWith('{')) {
    return value.slice(1, -1).split(',').filter(Boolean);
  }
  return [];
}

function affected(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  return Array.isArray(result[0])
    ? (result[0] as unknown[]).length
    : result.length;
}

const notFound = () =>
  new NotFoundException({
    errorCode: INVITE_ERROR.NOT_FOUND,
    message: INVITE_COPY.notFound,
  });
