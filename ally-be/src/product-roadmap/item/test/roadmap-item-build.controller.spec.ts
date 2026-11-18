import { NotFoundException } from '@nestjs/common';
import { RoadmapItemBuildController } from '../roadmap-item-build.controller';

const user = { id: 5 } as any;

function build(enabled: boolean) {
  const settings = {
    assertRoadmapV2: jest.fn(async () => {
      if (!enabled) throw new NotFoundException();
      return { enabled: true };
    }),
  };
  const service = {
    brief: jest.fn(async () => ({ markdown: '#' })),
    recordExternalBuild: jest.fn(async () => ({ code: 'OPP-0388' })),
  };
  return {
    controller: new RoadmapItemBuildController(
      settings as never,
      service as never,
    ),
    service,
  };
}

describe('RoadmapItemBuildController', () => {
  it('answers 404 while roadmap_v2 is off, before doing anything', async () => {
    const { controller, service } = build(false);
    await expect(controller.brief('OPP-0388', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.externalBuild('OPP-0388', {}, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.brief).not.toHaveBeenCalled();
    expect(service.recordExternalBuild).not.toHaveBeenCalled();
  });

  it('passes the caller through when it is on', async () => {
    const { controller, service } = build(true);
    await controller.brief('OPP-0388', user);
    await controller.externalBuild('OPP-0388', { tool: 'claude_code' }, user);
    expect(service.brief).toHaveBeenCalledWith(5, 'OPP-0388');
    expect(service.recordExternalBuild).toHaveBeenCalledWith(5, 'OPP-0388');
  });
});
