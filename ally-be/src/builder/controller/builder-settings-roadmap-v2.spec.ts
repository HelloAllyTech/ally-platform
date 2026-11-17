import { ForbiddenException } from '@nestjs/common';
import { BuilderController } from './builder.controller';

/**
 * The roadmap_v2 flag is the Owner's switch: a Builder settings PATCH that
 * touches it needs the Owner role (product_roadmap_manage); everything else
 * keeps the Builder gate.
 */
describe('BuilderController.updateSettings and roadmapV2Enabled', () => {
  const build = (role: string) => {
    const settingsService = { update: jest.fn(async (changes) => changes) };
    const roles = { roleOf: jest.fn(async () => role) };
    const controller = new (BuilderController as any)(
      ...new Array(19).fill(undefined),
      roles,
    ) as BuilderController;
    (controller as any).settingsService = settingsService;
    return { controller, settingsService, roles };
  };
  const user = { id: 5 } as any;

  it('refuses a Builder who is not an Owner, and writes nothing', async () => {
    const { controller, settingsService } = build('builder');
    await expect(
      controller.updateSettings({ roadmapV2Enabled: true } as any, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsService.update).not.toHaveBeenCalled();
  });

  it('lets an Owner switch it', async () => {
    const { controller, settingsService } = build('owner');
    await controller.updateSettings({ roadmapV2Enabled: true } as any, user);
    expect(settingsService.update).toHaveBeenCalledWith(
      expect.objectContaining({ roadmapV2Enabled: true }),
      5,
    );
  });

  it('leaves the other settings to Builders, without asking for a role', async () => {
    const { controller, settingsService, roles } = build('builder');
    await controller.updateSettings({ maxConcurrentBuilds: 4 } as any, user);
    expect(roles.roleOf).not.toHaveBeenCalled();
    expect(settingsService.update).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrentBuilds: 4 }),
      5,
    );
  });
});
