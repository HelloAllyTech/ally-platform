import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapMetricsController } from '../roadmap-metrics.controller';

describe('RoadmapMetricsController', () => {
  const owner = { id: 1 } as any;
  const make = (opts: { flag?: boolean; role?: string } = {}) => {
    const settings = {
      assertRoadmapV2: jest.fn(async () => {
        if (opts.flag === false) throw new NotFoundException();
        return { awaitingReviewAmberDays: 7 };
      }),
    };
    const roles = { roleOf: jest.fn(async () => opts.role ?? 'owner') };
    const metrics = { compute: jest.fn(async () => ({ ok: true })) };
    const controller = new RoadmapMetricsController(
      settings as any,
      roles as any,
      metrics as any,
    );
    return { controller, settings, roles, metrics };
  };

  it('answers 404 while roadmap_v2 is off, before anything else', async () => {
    const { controller, roles, metrics } = make({ flag: false });
    await expect(controller.metricsFor({}, owner)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(roles.roleOf).not.toHaveBeenCalled();
    expect(metrics.compute).not.toHaveBeenCalled();
  });

  it.each(['builder', 'idea', 'viewer', 'none'])(
    'answers 403 to a %s',
    async (role) => {
      const { controller, metrics } = make({ role });
      await expect(controller.metricsFor({}, owner)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(metrics.compute).not.toHaveBeenCalled();
    },
  );

  it('answers 400 for a reversed range', async () => {
    const { controller } = make();
    await expect(
      controller.metricsFor({ from: '2026-11-10', to: '2026-11-01' }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("computes for an Owner with the Owner's amber line", async () => {
    const { controller, metrics } = make();
    await controller.metricsFor(
      { from: '2026-11-01', to: '2026-11-30' },
      owner,
    );
    expect(metrics.compute).toHaveBeenCalledWith({
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-12-01T00:00:00Z'),
      amberDays: 7,
    });
  });
});
