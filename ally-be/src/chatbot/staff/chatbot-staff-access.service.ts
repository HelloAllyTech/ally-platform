import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { PermissionsService } from '../../authorization/service/permissions.service';
import type { StaffViewContext } from '../../common/execution/execution-manager';
import { StaffPolicy, staffWhatFor } from '../access/staff-access-matrix';
import { sqlHasRole } from '../access/chatbot-roles';
import {
  ChatbotAccessGrant,
  STAFF_GRANT_SCOPE,
} from '../entity/chatbot-access-grant.entity';
import { ChatbotStaffView } from '../entity/chatbot-staff-view.entity';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { SWITCHES, switchOn } from '../safety/switches';

/** An owner's grant: 24 hours unless they choose, never more than 7 days. */
export const STAFF_GRANT_DEFAULT_HOURS = 24;
export const STAFF_GRANT_MAX_HOURS = 7 * 24;

/** The view-log handler key for the staff "may I read conversations?" check. */
export const STAFF_CONVERSATION_ACCESS_HANDLER =
  'StaffChatbotsController.conversationAccess';

/** Why a staff read was refused (the staff member reads these). */
export const STAFF_MESSAGES = {
  // COPY: needs approval
  noGrant:
    "The owner hasn't given Ally staff access to this chatbot's conversations. Ask them to allow it in Settings.",
  // COPY: needs approval
  readOnly: 'Ally staff can only view this chatbot, not change it.',
  // COPY: needs approval
  logFailed:
    "We couldn't record this staff view, so it wasn't shown. Try again in a moment.",
} as const;

export interface StaffReadRequest {
  chatbotId: string | null;
  staffUserId: number;
  policy: StaffPolicy | 'search';
  /** `GET /v1/chatbots/:id/home` */
  route: string;
  /** `Controller.handler` */
  handler: string;
  conversationId?: string | null;
  target?: string | null;
}

export interface StaffGrantView {
  id: string;
  grantedBy: number;
  grantedByName: string | null;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  status: 'live' | 'expired' | 'revoked';
}

/**
 * Assistants stage 8: Ally staff's read-only view of any chatbot.
 *
 * Who is staff (the `system:access` permission, as `StaffOnlyGuard`), the owner's time-limited
 * grants for conversations, and the view log. `authorizeRead` writes the log row BEFORE it says
 * yes, and a failed write refuses the read (fail closed). It never decides edit rights: callers
 * only ask it about view routes, and `ChatbotAccessService` admits staff to VIEW only.
 */
@Injectable()
export class ChatbotStaffAccessService {
  private readonly logger = new Logger(ChatbotStaffAccessService.name);

  constructor(
    @InjectRepository(ChatbotAccessGrant)
    private readonly grants: Repository<ChatbotAccessGrant>,
    @InjectRepository(ChatbotStaffView)
    private readonly views: Repository<ChatbotStaffView>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
  ) {}

  enabled(): boolean {
    return switchOn(this.config, SWITCHES.staffView);
  }

  async isStaff(userId: number): Promise<boolean> {
    if (!userId) return false;
    const granted = await this.permissions.getUserPermissions(userId);
    return granted.includes(PERMISSIONS.SYSTEM_ACCESS);
  }

  /** The owner's live grant on this chatbot, if any. */
  async liveGrant(chatbotId: string): Promise<{ id: string } | null> {
    // The database clock decides expiry, the same one that wrote `expires_at`.
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM chatbot_access_grants
        WHERE chatbot_id = $1 AND scope = $2
          AND revoked_at IS NULL AND expires_at > now()
        ORDER BY expires_at DESC
        LIMIT 1`,
      [chatbotId, STAFF_GRANT_SCOPE],
    );
    return rows[0] ?? null;
  }

  /**
   * Whether a staff member may make this read, recording it first.
   *
   * - `null`: the caller is not staff (or the staff view is switched off): answer as before.
   * - throws 403: staff, but the route is never for staff, or it reads conversations with no live
   *   grant. Nothing is logged: nothing was read.
   * - throws 503: the log row could not be written, so the read is refused.
   * - otherwise the context the services' own view checks honour for this request.
   */
  async authorizeRead(req: StaffReadRequest): Promise<StaffViewContext | null> {
    if (!this.enabled() || !req.chatbotId) return null;
    if (!(await this.isStaff(req.staffUserId))) return null;
    if (req.policy === 'deny' || req.policy === 'search') {
      throw new ForbiddenException(STAFF_MESSAGES.readOnly);
    }
    let grantId: string | null = null;
    if (req.policy === 'conversations') {
      const grant = await this.liveGrant(req.chatbotId);
      if (!grant) throw new ForbiddenException(STAFF_MESSAGES.noGrant);
      grantId = grant.id;
    }
    await this.recordView({ ...req, grantId });
    return {
      chatbotId: req.chatbotId,
      staffUserId: req.staffUserId,
      grantId,
    };
  }

  /** Write one view row; any failure refuses the read. */
  async recordView(
    req: StaffReadRequest & { grantId?: string | null },
  ): Promise<void> {
    try {
      await this.views.insert({
        chatbotId: req.chatbotId,
        staffUserId: req.staffUserId,
        policy: req.policy,
        route: req.route.slice(0, 255),
        handler: req.handler.slice(0, 128),
        conversationId: req.conversationId ?? null,
        target: req.target ? req.target.slice(0, 255) : null,
        grantId: req.grantId ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Staff view log write failed; read refused (${req.handler})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(STAFF_MESSAGES.logFailed);
    }
  }

  // ---- The owner's side -------------------------------------------------------------------

  /** Give Ally staff access to conversations; any earlier live grant is replaced. */
  async grant(
    chatbotId: string,
    ownerId: number,
    input: { hours?: number; reason?: string | null } = {},
  ): Promise<StaffGrantView> {
    const hours = input.hours ?? STAFF_GRANT_DEFAULT_HOURS;
    if (
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > STAFF_GRANT_MAX_HOURS
    ) {
      throw new BadRequestException(
        // COPY: needs approval
        `Choose between 1 hour and ${STAFF_GRANT_MAX_HOURS / 24} days.`,
      );
    }
    const reason = input.reason?.trim() || null;
    const id = await this.dataSource.transaction(async (tx) => {
      await tx.query(
        `UPDATE chatbot_access_grants
            SET revoked_at = now(), revoked_by = $2
          WHERE chatbot_id = $1 AND scope = $3
            AND revoked_at IS NULL AND expires_at > now()`,
        [chatbotId, ownerId, STAFF_GRANT_SCOPE],
      );
      // The window is computed by the database, so the CHECK and the expiry use one clock.
      const rows: { id: string }[] = await tx.query(
        `INSERT INTO chatbot_access_grants
           (chatbot_id, granted_by, scope, reason, expires_at, created_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5::int), now())
         RETURNING id`,
        [chatbotId, ownerId, STAFF_GRANT_SCOPE, reason, hours],
      );
      return rows[0].id;
    });
    const [view] = await this.listGrants(chatbotId, id);
    return view;
  }

  async revoke(
    chatbotId: string,
    grantId: string,
    ownerId: number,
  ): Promise<void> {
    const grant = await this.grants.findOne({
      where: { id: grantId, chatbotId },
    });
    if (!grant) throw new NotFoundException('That permission was not found.');
    if (grant.revokedAt) return;
    await this.dataSource.query(
      `UPDATE chatbot_access_grants SET revoked_at = now(), revoked_by = $3
        WHERE id = $1 AND chatbot_id = $2 AND revoked_at IS NULL`,
      [grantId, chatbotId, ownerId],
    );
  }

  /** The chatbot's grants, newest first (the last 20), or one of them. */
  async listGrants(
    chatbotId: string,
    onlyId?: string,
  ): Promise<StaffGrantView[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT g.id, g.granted_by, u.name AS granted_by_name, g.reason, g.created_at,
              g.expires_at, g.revoked_at,
              CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked'
                   WHEN g.expires_at <= now() THEN 'expired'
                   ELSE 'live' END AS status
         FROM chatbot_access_grants g
         LEFT JOIN users u ON u.id = g.granted_by
        WHERE g.chatbot_id = $1 AND ($2::uuid IS NULL OR g.id = $2::uuid)
        ORDER BY g.created_at DESC
        LIMIT 20`,
      [chatbotId, onlyId ?? null],
    );
    return rows.map((r) => ({
      id: String(r.id),
      grantedBy: Number(r.granted_by),
      grantedByName: (r.granted_by_name as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as Date,
      expiresAt: r.expires_at as Date,
      revokedAt: (r.revoked_at as Date | null) ?? null,
      status: r.status as StaffGrantView['status'],
    }));
  }

  /** Who from Ally looked at this chatbot, when and at what (newest first). */
  async listViews(chatbotId: string, limit = 100) {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT v.id, v.viewed_at, v.staff_user_id, u.name AS staff_name, v.policy,
              v.handler, v.route, v.conversation_id, v.grant_id
         FROM chatbot_staff_views v
         LEFT JOIN users u ON u.id = v.staff_user_id
        WHERE v.chatbot_id = $1
        ORDER BY v.viewed_at DESC
        LIMIT $2`,
      [chatbotId, Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      at: r.viewed_at as Date,
      staffUserId: Number(r.staff_user_id),
      staffName: (r.staff_name as string | null) ?? null,
      what: staffWhatFor(String(r.handler)),
      conversations: r.policy === 'conversations',
      conversationId: (r.conversation_id as string | null) ?? null,
      route: String(r.route),
    }));
  }

  // ---- The staff read-only conversations view ----------------------------------------------

  /**
   * Whether the owner's grant to read conversations is live, and until when: the grant's existence
   * and expiry only, never conversation content. Lets the staff view show the right state without
   * asking a conversation route (and getting a 403). Logged (fail closed) as a `setup` view.
   * 404 when the staff view is switched off or the chatbot does not exist.
   */
  async conversationAccess(
    staffUserId: number,
    chatbotId: string,
  ): Promise<{ granted: boolean; expiresAt?: string }> {
    if (!this.enabled()) throw new NotFoundException();
    const [bot] = (await this.dataSource.query(
      `SELECT id FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { id: string }[];
    if (!bot) throw new NotFoundException('Chatbot not found');
    const rows: { id: string; expires_at: Date | string }[] =
      await this.dataSource.query(
        `SELECT id, expires_at FROM chatbot_access_grants
          WHERE chatbot_id = $1 AND scope = $2
            AND revoked_at IS NULL AND expires_at > now()
          ORDER BY expires_at DESC
          LIMIT 1`,
        [chatbotId, STAFF_GRANT_SCOPE],
      );
    const grant = rows[0];
    await this.recordView({
      chatbotId,
      staffUserId,
      policy: 'setup',
      route: 'GET /v1/staff/chatbots/:id/conversation-access',
      handler: STAFF_CONVERSATION_ACCESS_HANDLER,
      grantId: grant?.id ?? null,
    });
    if (!grant) return { granted: false };
    return {
      granted: true,
      expiresAt: new Date(grant.expires_at).toISOString(),
    };
  }

  // ---- The staff search ---------------------------------------------------------------------

  /**
   * Chatbots by name or owner (name or email), for the staff support page. Logged (fail closed) as
   * a search with no chatbot; opening one is logged by the routes it reads.
   */
  async search(staffUserId: number, query: string, limit = 25) {
    if (!this.enabled()) throw new NotFoundException();
    const q = (query ?? '').trim().slice(0, 100);
    await this.recordView({
      chatbotId: null,
      staffUserId,
      policy: 'search',
      route: 'GET /v1/staff/chatbots',
      handler: 'StaffChatbotsController.search',
      target: q || null,
    });
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT c.id, c.name, c.status, c.archived_at, c."createdAt" AS created_at,
              COALESCE(json_agg(json_build_object('name', u.name, 'email', u.email,
                         'tenantId', u.tenant_id))
                       FILTER (WHERE u.id IS NOT NULL), '[]') AS owners,
              EXISTS (SELECT 1 FROM chatbot_access_grants g
                       WHERE g.chatbot_id = c.id AND g.revoked_at IS NULL
                         AND g.expires_at > now()) AS conversations_allowed
         FROM chatbots c
         LEFT JOIN chatbot_members m
           ON m.chatbot_id = c.id AND ${sqlHasRole('m', ChatbotMemberRole.OWNER)}
         LEFT JOIN users u ON u.id = m.user_id
        WHERE $1 = '' OR c.name ILIKE $2 OR EXISTS (
                SELECT 1 FROM chatbot_members m2 JOIN users u2 ON u2.id = m2.user_id
                 WHERE m2.chatbot_id = c.id AND ${sqlHasRole('m2', ChatbotMemberRole.OWNER)}
                   AND (u2.name ILIKE $2 OR u2.email ILIKE $2))
        GROUP BY c.id
        ORDER BY c."updatedAt" DESC
        LIMIT $3`,
      [q, like, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      status: String(r.status ?? ''),
      archived: !!r.archived_at,
      createdAt: r.created_at as Date,
      owners: (r.owners ?? []) as {
        name: string;
        email: string;
        tenantId: string | null;
      }[],
      conversationsAllowed: !!r.conversations_allowed,
    }));
  }
}
