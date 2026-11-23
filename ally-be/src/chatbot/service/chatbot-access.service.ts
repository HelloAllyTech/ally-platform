import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { TenantScopeService } from '../../authorization/service/tenant-scope.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Chatbot } from '../entity/chatbot.entity';
import { ChatbotMember } from '../entity/chatbot-member.entity';
import { CHATBOT_ROLE_RANK, ChatbotMemberRole } from '../enum/chatbot.enum';

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
  ) {}

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

  /** The caller's role on each of the given bots; a bot they are not on is absent. */
  async rolesFor(
    chatbotIds: string[],
    userId = currentUserId(),
  ): Promise<Map<string, ChatbotMemberRole>> {
    if (!chatbotIds.length || !userId) return new Map();
    const rows = await this.memberRepository.find({
      where: { userId, chatbotId: In(chatbotIds) },
    });
    return new Map(rows.map((r) => [r.chatbotId, r.role]));
  }

  /**
   * Load a bot the caller holds at least `minRole` on. An archived bot loads only for viewing.
   */
  async assert(
    chatbotId: string,
    minRole: ChatbotMemberRole = ChatbotMemberRole.VIEWER,
    userId = currentUserId(),
  ): Promise<{ chatbot: Chatbot; role: ChatbotMemberRole }> {
    const chatbot = await this.chatbotRepository.findOne({
      where: { id: chatbotId },
    });
    // A removed (archived) bot stays readable, for the Archived list's "what happened", and is
    // never changed: anything above viewing treats it as gone.
    if (
      !chatbot ||
      (chatbot.archivedAt && minRole !== ChatbotMemberRole.VIEWER)
    ) {
      throw new NotFoundException('Chatbot not found');
    }

    const member = userId
      ? await this.memberRepository.findOne({ where: { chatbotId, userId } })
      : null;
    const role = member?.role;
    if (!role) throw new NotFoundException('Chatbot not found');
    if (CHATBOT_ROLE_RANK[role] < CHATBOT_ROLE_RANK[minRole]) {
      throw new ForbiddenException(
        minRole === ChatbotMemberRole.OWNER
          ? "Only this chatbot's owners can do this."
          : 'You can view this chatbot but not change it.',
      );
    }
    return { chatbot, role };
  }
}
