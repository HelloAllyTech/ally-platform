import { StubCreditsStateService } from '../service/credits-state.service';

describe('StubCreditsStateService', () => {
  it('says credits are available until the ledger replaces it', async () => {
    await expect(
      new StubCreditsStateService().creditsAvailable(),
    ).resolves.toEqual({ available: true });
  });
});
