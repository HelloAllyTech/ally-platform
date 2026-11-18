import { NotFoundException } from '@nestjs/common';
import { RoadmapDraftController } from '../roadmap-draft.controller';
import { RoadmapReviewController } from '../../review/roadmap-review.controller';

/**
 * Everything P3 adds is dark while roadmap_v2 is off: every handler asks the
 * flag first and touches no service when it answers 404.
 */
describe('P3 routes while roadmap_v2 is off', () => {
  const settings = {
    assertRoadmapV2: jest.fn(async () => {
      throw new NotFoundException();
    }),
  };
  const untouchable = new Proxy(
    {},
    {
      get: (_t, prop) => () => {
        throw new Error(`service.${String(prop)} called with the flag off`);
      },
    },
  );
  const user = { id: 7 } as any;

  const cases: [string, any][] = [
    [
      'RoadmapDraftController',
      new RoadmapDraftController(
        settings as any,
        untouchable as any,
        untouchable as any,
      ),
    ],
    [
      'RoadmapReviewController',
      new RoadmapReviewController(settings as any, untouchable as any),
    ],
  ];

  for (const [name, controller] of cases) {
    const handlers = Object.getOwnPropertyNames(
      Object.getPrototypeOf(controller),
    ).filter((m) => m !== 'constructor');

    it(`${name}: every handler answers 404 (${handlers.length})`, async () => {
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const args = new Array(controller[handler].length).fill(undefined);
        // Fill whatever position is the user with a user, the rest with junk.
        const call = controller[handler](
          ...args.map((_: unknown, i: number) => (i === 0 ? 'OPP-0001' : user)),
        );
        await expect(call).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  }
});
