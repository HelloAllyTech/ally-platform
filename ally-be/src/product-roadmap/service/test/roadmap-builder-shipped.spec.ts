import { RoadmapBuilderService } from '../roadmap-builder.service';

/**
 * The board telling the truth about work that has shipped.
 *
 * An opportunity handed to Builder sat at whatever stage it was in while the
 * build ran, merged and deployed. This reconcile was added to move it, but it
 * read `builder_pull_requests.releaseState`: null whenever Builder's
 * auto-release was off (so nothing ever moved) and `skipped` counted as
 * delivered (so things moved without being deployed). Since Roadmap v2 P1 the
 * decision is release tracking's (item-release.service.spec); this spec pins
 * that the old reading is gone.
 */
describe('RoadmapBuilderService.reconcileShippedOpportunities', () => {
  const build = () => {
    const getDeliveryState = jest.fn(async () => ({
      shipped: true,
      pullRequestCount: 1,
    }));
    const reconcile = jest.fn(async () => null);
    const repo = { find: jest.fn(async () => []), update: jest.fn() };
    const service = new RoadmapBuilderService(
      repo as never,
      { getDeliveryState } as never,
      {} as never,
      {} as never,
      { reconcile } as never,
    );
    return { service, getDeliveryState, reconcile, repo };
  };

  it('delegates to release tracking', async () => {
    const { service, reconcile } = build();

    await service.reconcileShippedOpportunities();

    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  /**
   * A session whose pull requests are all `skipped` used to read as shipped.
   * It must not move anything on its own any more.
   */
  it('no longer releases anything from Builder release state', async () => {
    const { service, getDeliveryState, repo } = build();

    await service.reconcileShippedOpportunities();

    expect(getDeliveryState).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
