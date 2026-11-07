import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { TenantScopeService } from '../../authorization/service/tenant-scope.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Chatbot } from '../entity/chatbot.entity';
import { ChatbotMember } from '../entity/chatbot-member.entity';
import { CHATBOT_ROLE_RANK, ChatbotMemberRole } from '../enum/chatbot.enum';

const currentUserId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * Who may see and manage which bot.
 *
 * A platform admin with platform-wide scope (no organisation allowlist, no single home
 * organisation) manages every bot, and is the only one who can create bots, change the defaults
 * every bot inherits, or connect numbers that belong to no bot. Everyone else sees exactly the bots
 * they are a member of, at the role they were given there.
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

  /** The bots the caller can see; `null` means every bot. */
  async accessibleChatbotIds(
    userId = currentUserId(),
  ): Promise<string[] | null> {
    if (await this.isPlatformAdmin(userId)) return null;
    const rows = await this.memberRepository.find({
      where: { userId },
      select: ['chatbotId'],
    });
    return rows.map((r) => r.chatbotId);
  }

  /** The caller's role on each of the given bots (platform admins are owners everywhere). */
  async rolesFor(
    chatbotIds: string[],
    userId = currentUserId(),
  ): Promise<Map<string, ChatbotMemberRole>> {
    if (await this.isPlatformAdmin(userId)) {
      return new Map(chatbotIds.map((id) => [id, ChatbotMemberRole.OWNER]));
    }
    if (!chatbotIds.length) return new Map();
    const rows = await this.memberRepository.find({
      where: { userId, chatbotId: In(chatbotIds) },
    });
    return new Map(rows.map((r) => [r.chatbotId, r.role]));
  }

  /**
   * Load a live (not archived) bot the caller holds at least `minRole` on.
   */
  async assert(
    chatbotId: string,
    minRole: ChatbotMemberRole = ChatbotMemberRole.VIEWER,
    userId = currentUserId(),
  ): Promise<{ chatbot: Chatbot; role: ChatbotMemberRole }> {
    const chatbot = await this.chatbotRepository.findOne({
      where: { id: chatbotId, archivedAt: IsNull() },
    });
    if (!chatbot) throw new NotFoundException('Chatbot not found');

    let role: ChatbotMemberRole | undefined;
    if (await this.isPlatformAdmin(userId)) {
      role = ChatbotMemberRole.OWNER;
    } else {
      const member = await this.memberRepository.findOne({
        where: { chatbotId, userId },
      });
      role = member?.role;
    }
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
