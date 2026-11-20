import { DebriefContextRepository } from '../service/debrief-context.repository';
import { ALLOWLIST_WHEN_UNREADABLE } from '../util/debrief-provider-allowlist.util';

/** An unreadable provider allowlist allows nothing, in every place that reads it. */
describe('the provider allowlist fails closed', () => {
  it('is empty by definition', () => {
    expect(ALLOWLIST_WHEN_UNREADABLE).toEqual([]);
  });

  it('the context repository allows nothing when it cannot read the organisation’s row', async () => {
    const repo = new DebriefContextRepository({
      query: jest.fn(async () => {
        throw new Error('db blip');
      }),
    } as any);
    expect(await repo.providerAllowlist('t1')).toEqual([]);
    // No organisation: the default, every approved provider.
    expect((await repo.providerAllowlist(null)).length).toBeGreaterThan(0);
  });
});
