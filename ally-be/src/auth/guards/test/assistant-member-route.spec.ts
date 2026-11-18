import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  AssistantScope,
  ChatbotRole,
} from 'src/chatbot/access/chatbot-role.decorator';
import { ChatbotMemberRole } from 'src/chatbot/enum/chatbot.enum';
import { RequireFeatureToggle } from '../../decorators/feature-toggle.decorator';
import { FeatureToggleGuard } from '../feature-toggle.guard';
import { PermissionsGuard } from '../permissions.guard';

/**
 * Chunk 6b, item 31: being on an assistant's team is enough to use it. On a route naming an
 * assistant (ChatbotMemberGuard then checks the team and role) and on the list of one's own
 * assistants, the toggle and the role permission aren't required. Creating one still is.
 */
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
class Routes {
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  oneAssistant() {}

  @AssistantScope('list')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  myAssistants() {}

  @AssistantScope('create')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  create() {}

  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  service() {}
}

const member = { id: 42, tenantId: 'tenant-a' };
const contextFor = (handler: keyof Routes): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: member, query: {} }) }),
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
  }) as unknown as ExecutionContext;

describe('assistant routes and team membership', () => {
  const reflector = new Reflector();
  const toggles = new FeatureToggleGuard(
    reflector,
    {
      hasToggle: jest.fn().mockResolvedValue(false),
      isWithheld: jest.fn().mockResolvedValue(false),
      isLimitedToOrgScopedRoutes: jest.fn().mockResolvedValue(false),
    } as never,
    { isEnabledForTenant: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
    { getUserPermissions: jest.fn().mockResolvedValue([]) } as never,
  );
  const permissions = new PermissionsGuard(reflector, {
    getUserPermissions: jest.fn().mockResolvedValue([]),
  } as never);

  it('a route naming an assistant needs no toggle or permission: its team decides', async () => {
    await expect(
      permissions.canActivate(contextFor('oneAssistant')),
    ).resolves.toBe(true);
    await expect(toggles.canActivate(contextFor('oneAssistant'))).resolves.toBe(
      true,
    );
  });

  it('so does the list of their own assistants', async () => {
    await expect(
      permissions.canActivate(contextFor('myAssistants')),
    ).resolves.toBe(true);
    await expect(toggles.canActivate(contextFor('myAssistants'))).resolves.toBe(
      true,
    );
  });

  it('creating one, and service routes, still need the permission and the toggle', async () => {
    for (const route of ['create', 'service'] as const) {
      await expect(
        permissions.canActivate(contextFor(route)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        toggles.canActivate(contextFor(route)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
