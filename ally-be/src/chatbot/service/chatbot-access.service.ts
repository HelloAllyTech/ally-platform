import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { TenantScopeService } from '../../authorization/service/tenant-scope.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Chatbot } from '../entity/chatbot.entity';
import { ChatbotMember } from '../entity/chatbot-member.entity';
import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';
import {
  can,
  capabilityForLegacyRole,
  legacyRole,
  rolesOfRow,
} from '../access/chatbot-roles';
import { StaffPolicy, staffPolicyFor } from '../access/staff-access-matrix';
import {
  ChatbotStaffAccessService,
  STAFF_MESSAGES,
} from '../staff/chatbot-staff-access.service';

/** What `assert` / `assertCan` return: the bot and the caller's roles on it. */
export interface ChatbotAccess {
  chatbot: Chatbot;
  /** OLD single role (highest on the old ladder), for callers not yet moved to `roles`. */
  role: ChatbotMemberRole;
  roles: ChatbotMemberRole[];
  /** Stage 8: an Ally staff read-only view (no roles; view only; already logged). */
  staff?: boolean;
}

/** The route a guarded read came through, for the stage 8 staff view and its log. */
export interface StaffRouteInfo {
  /** `Controller.handler`, the staff-access matrix key. */
  key: string;
  /** `GET /v1/chatbots/:id/home` */
  route: string;
  params?: Record<string, unknown>;
  conversationId?: string | null;
  target?: string | null;
}

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * Who may see and manage which bot.
 *
 * Everyone, platform admins included, sees exactly the bots they are a member of, at the role they
 * were given there (A1: owners only; there is no view of every bot). Anyone with the Chatbots
 * feature (WHATSAPP_BOT) may create a bot and becomes its owner. Platform-wide scope is still needed
 * for what belongs to no bot: the defaults every bot inherits, and connectors or numbers that are
 * not bound to a bot.
 *
 * A bot the caller cannot see answers exactly like one that does not exist (404), so ids cannot be
 * probed; a bot they can see but not change answers 403.
 *
 * Stage 8 exception: Ally staff may VIEW any bot, but only through a guarded route the staff
 * access matrix allows (`assertCanOnRoute`), and only after that read was logged. The guard then
 * marks the request, and `assertCan` admits that staff member to VIEW on that one bot for the rest
 * of the request. Never build, respond or manage people.
 */
@Injectable()
export class ChatbotAccessService {
  constructor(
    @InjectRepository(Chatbot)
    private readonly chatbotRepository: Repository<Chatbot>,
    @InjectRepository(ChatbotMember)
    private readonly memberRepository: Repository<ChatbotMember>,
    private readonly tenantScope: TenantScopeService,
    private readonly featureToggles: FeatureToggleService,
    @Optional()
    private readonly staff?: ChatbotStaffAccessService,
  ) {}

  /** Whether this request is an Ally staff read-only view of `chatbotId` (stage 8). */
  isStaffView(chatbotId: string, userId = currentUserId()): boolean {
    const view = ExecutionManager.getStaffView();
    return (
      !!view && view.chatbotId === chatbotId && view.staffUserId === userId
    );
  }

  /**
   * The guard's check: `assertCan`, and for a VIEW route that answers 404 to a non-member, the
   * staff read-only path (stage 8): the route's matrix policy, the owner's grant for
   * conversations, and the log row written first (a failed write refuses the read).
   */
  async assertCanOnRoute(
    chatbotId: string,
    capability: ChatbotCapability,
    userId: number,
    route: StaffRouteInfo,
  ): Promise<ChatbotAccess> {
    try {
      return await this.assertCan(chatbotId, capability, userId);
    } catch (error) {
      if (
        !(error instanceof NotFoundException) ||
        capability !== ChatbotCapability.VIEW ||
        !this.staff
      ) {
        throw error;
      }
      // A bot that does not exist stays a 404, and is never logged.
      const exists = await this.chatbotRepository.findOne({
        where: { id: chatbotId },
        select: ['id'],
      });
      if (!exists) throw error;
      const view = await this.staff.authorizeRead({
        chatbotId,
        staffUserId: userId,
        policy: staffPolicyFor(route.key, route.params),
        route: route.route,
        handler: route.key,
        conversationId: route.conversationId ?? null,
        target: route.target ?? null,
      });
      if (!view) throw error;
      if (!ExecutionManager.setStaffView(view)) {
        throw new ServiceUnavailableException(STAFF_MESSAGES.logFailed);
      }
      return this.assertCan(chatbotId, ChatbotCapability.VIEW, userId);
    }
  }

  /**
   * A list-scope route (no bot in the path) asked about one bot by `?chatbotId=` (stage 8): for
   * staff who are not on that bot, the bot ids to list (after the read is authorised and logged);
   * `undefined` for everyone else, who keep the normal member scope.
   */
  async staffListScope(
    chatbotId: string | undefined,
    route: StaffRouteInfo,
    userId = currentUserId(),
  ): Promise<string[] | undefined> {
    if (!chatbotId || !this.staff || !userId) return undefined;
    if ((await this.rolesOn(chatbotId, userId)).length) return undefined;
    const exists = await this.chatbotRepository.findOne({
      where: { id: chatbotId },
      select: ['id'],
    });
    if (!exists) return undefined;
    const policy: StaffPolicy = staffPolicyFor(route.key, route.params);
    const view = await this.staff.authorizeRead({
      chatbotId,
      staffUserId: userId,
      policy,
      route: route.route,
      handler: route.key,
    });
    if (!view) return undefined;
    ExecutionManager.setStaffView(view);
    return [chatbotId];
  }

  async isPlatformAdmin(userId = currentUserId()): Promise<boolean> {
    return (await this.tenantScope.resolveTenantIds(userId)) === null;
  }

  async assertPlatformAdmin(userId = currentUserId()): Promise<void> {
    if (!(await this.isPlatformAdmin(userId))) {
      throw new ForbiddenException(
        'Only a platform admin can do this. Ask an Ally admin.',
      );
    }
  }

  /** Whether the caller may create a bot: they hold the Chatbots feature. */
  async canCreate(userId = currentUserId()): Promise<boolean> {
    if (!userId) return false;
    return this.featureToggles.hasToggle(userId, FeatureToggleKey.WHATSAPP_BOT);
  }

  async assertCanCreate(userId = currentUserId()): Promise<void> {
    if (!(await this.canCreate(userId))) {
      throw new ForbiddenException(
        'Creating a chatbot needs the Chatbots feature. Ask an Ally admin.',
      );
    }
  }

  /** The bots the caller is a member of (platform admins included). */
  async accessibleChatbotIds(userId = currentUserId()): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.memberRepository.find({
      where: { userId },
      select: ['chatbotId'],
    });
    return rows.map((r) => r.chatbotId);
  }

  /** The caller's roles on each of the given bots; a bot they are not on is absent. */
  async roleSetsFor(
    chatbotIds: string[],
    userId = currentUserId(),
  ): Promise<Map<string, ChatbotMemberRole[]>> {
    if (!chatbotIds.length || !userId) return new Map();
    const rows = await this.memberRepository.find({
      where: { userId, chatbotId: In(chatbotIds) },
    });
    return new Map(rows.map((r) => [r.chatbotId, rolesOfRow(r)]));
  }

  /** The caller's OLD single role on each bot (highest of their set on the old ladder). */
  async rolesFor(
    chatbotIds: string[],
    userId = currentUserId(),
  ): Promise<Map<string, ChatbotMemberRole>> {
    const sets = await this.roleSetsFor(chatbotIds, userId);
    return new Map([...sets].map(([id, roles]) => [id, legacyRole(roles)]));
  }

  /**
   * Back-compat shim: the old "at least `minRole`" check, now the capability it meant (viewer:
   * view, editor: build, owner: manage people). A responder passes a viewer check and no other.
   */
  async assert(
    chatbotId: string,
    minRole: ChatbotMemberRole = ChatbotMemberRole.VIEWER,
    userId = currentUserId(),
  ): Promise<ChatbotAccess> {
    return this.assertCan(chatbotId, capabilityForLegacyRole(minRole), userId);
  }

  /**
   * Load a bot the caller holds `capability` on. 404 to anyone not on it (platform admins
   * included); 403 to a member without the capability. An archived bot loads only for viewing.
   */
  async assertCan(
    chatbotId: string,
    capability: ChatbotCapability,
    userId = currentUserId(),
  ): Promise<ChatbotAccess> {
    const chatbot = await this.chatbotRepository.findOne({
      where: { id: chatbotId },
    });
    // A removed (archived) bot stays readable, for the Archived list's "what happened", and is
    // never changed: anything above viewing treats it as gone.
    if (
      !chatbot ||
      (chatbot.archivedAt && capability !== ChatbotCapability.VIEW)
    ) {
      throw new NotFoundException('Chatbot not found');
    }

    const member = userId
      ? await this.memberRepository.findOne({ where: { chatbotId, userId } })
      : null;
    const roles = member ? rolesOfRow(member) : [];
    if (!roles.length) {
      // Stage 8: a staff read the guard already authorised and logged, on this bot, view only.
      if (
        capability === ChatbotCapability.VIEW &&
        this.isStaffView(chatbotId, userId)
      ) {
        return {
          chatbot,
          role: ChatbotMemberRole.VIEWER,
          roles: [],
          staff: true,
        };
      }
      throw new NotFoundException('Chatbot not found');
    }
    if (!can(roles, capability)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE[capability]);
    }
    return { chatbot, role: legacyRole(roles), roles };
  }

  /**
   * For a read-only route that members need `role` for but that staff may also read (matrix policy
   * `setup`): staff on this request's logged view pass, everyone else is checked as `assert`.
   */
  async assertOrStaffView(
    chatbotId: string,
    role: ChatbotMemberRole,
    userId = currentUserId(),
  ): Promise<void> {
    if (userId && this.isStaffView(chatbotId, userId)) return;
    await this.assert(chatbotId, role);
  }

  /**
   * Whether this request may show customers' own words: always for members; for staff only while
   * the owner's grant is live. Used to keep verbatim questions out of setup-level analytics.
   */
  async mayReadCustomerText(
    chatbotId: string,
    userId = currentUserId(),
  ): Promise<boolean> {
    if (!userId || !this.isStaffView(chatbotId, userId)) return true;
    return !!(await this.staff?.liveGrant(chatbotId));
  }

  /** The caller's roles on one bot, or [] when they are not on it. No bot or archive check. */
  async rolesOn(chatbotId: string, userId = currentUserId()) {
    if (!userId) return [];
    const member = await this.memberRepository.findOne({
      where: { chatbotId, userId },
    });
    return member ? rolesOfRow(member) : [];
  }
}

const FORBIDDEN_MESSAGE: Record<ChatbotCapability, string> = {
  [ChatbotCapability.VIEW]: 'You can view this chatbot but not change it.',
  [ChatbotCapability.BUILD]: 'You can view this chatbot but not change it.',
  [ChatbotCapability.RESPOND]:
    "Only this chatbot's responders, editors and owners can reply to people.",
  [ChatbotCapability.MANAGE_PEOPLE]: "Only this chatbot's owners can do this.",
};
