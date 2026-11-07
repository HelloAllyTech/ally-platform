import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../type/whatsapp-settings.type';
import { WhatsAppAdminController } from '../whatsapp-admin.controller';

/**
 * `PUT /v1/whatsapp/settings` is open to anyone with the WhatsApp bot edit permission. The two
 * chunk-12b switches (public bot pages, the dashboard's store) need a platform admin on top.
 */
describe('PUT /v1/whatsapp/settings and the platform-admin-only switches', () => {
  function controller(isPlatformAdmin: boolean) {
    const adminService = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ ...DEFAULT_WHATSAPP_SETTINGS }),
      updateSettings: jest.fn().mockResolvedValue({ ok: true }),
    };
    const access = {
      assertPlatformAdmin: jest.fn(async () => {
        if (!isPlatformAdmin) throw new ForbiddenException();
      }),
    };
    return {
      adminService,
      access,
      route: new WhatsAppAdminController(
        adminService as never,
        access as never,
      ),
    };
  }

  it('lets a bot editor change ordinary settings', async () => {
    const { route, adminService, access } = controller(false);
    await route.updateSettings({ declineText: 'Ask HR.' } as never);
    expect(access.assertPlatformAdmin).not.toHaveBeenCalled();
    expect(adminService.updateSettings).toHaveBeenCalledWith({
      declineText: 'Ask HR.',
    });
  });

  it.each([{ botPagePublicAllowed: true }, { dashboardReadsFrom: 'shared' }])(
    'refuses %j from someone who is not a platform admin',
    async (patch) => {
      const { route, adminService } = controller(false);
      await expect(route.updateSettings(patch as never)).rejects.toThrow(
        ForbiddenException,
      );
      expect(adminService.updateSettings).not.toHaveBeenCalled();
    },
  );

  it('lets a platform admin turn public bot pages on', async () => {
    const { route, adminService } = controller(true);
    await route.updateSettings({ botPagePublicAllowed: true } as never);
    expect(adminService.updateSettings).toHaveBeenCalledWith({
      botPagePublicAllowed: true,
    });
  });

  it('round-trips an unchanged value without asking', async () => {
    const { route, access } = controller(false);
    await route.updateSettings({
      botPagePublicAllowed: false,
      dashboardReadsFrom: 'wa',
    } as never);
    expect(access.assertPlatformAdmin).not.toHaveBeenCalled();
  });
});
