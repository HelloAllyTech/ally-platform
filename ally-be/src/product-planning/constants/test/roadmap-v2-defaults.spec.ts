import {
  AUTO_RELEASE_HELD_PATHS_DEFAULT,
  ROADMAP_V2_DEFAULTS,
} from '../product-planning.constants';
import { PlanSettingsService } from '../../service/plan-settings.service';

/**
 * Pins the Roadmap v2 defaults (plans/roadmap-builder-merge §3.2, §5.5, §5.6).
 * The held-path list decides which releases wait for a person: shrinking it
 * by accident lets a migration or an auth change ship unattended, so a change
 * here has to be a deliberate edit to this spec too.
 */
describe('Roadmap v2 defaults', () => {
  it('holds migrations, auth, permissions, roles, payments and billing', () => {
    expect([...AUTO_RELEASE_HELD_PATHS_DEFAULT]).toEqual([
      'ally-be/src/database/migrations/**',
      '**/auth/**',
      '**/authorization/**',
      '**/*permission*.constants.ts',
      '**/*role*.constants.ts',
      '**/*payment*',
      '**/*billing*',
    ]);
  });

  it('keeps the plan defaults', () => {
    expect(ROADMAP_V2_DEFAULTS).toEqual({
      IN_PROGRESS_LIMIT: 3,
      MAX_LEAD_CEILING_USD: 200,
      AWAITING_REVIEW_AMBER_DAYS: 5,
    });
  });

  describe('PlanSettingsService.getRoadmapV2', () => {
    const serviceWith = (row: Record<string, unknown> | null) =>
      new PlanSettingsService({
        findOne: jest.fn().mockResolvedValue(row),
      } as never);

    it('is off, with defaults, when there is no settings row', async () => {
      const settings = await serviceWith(null).getRoadmapV2();
      expect(settings).toEqual({
        enabled: false,
        ceilingUsd: 100,
        maxLeadCeilingUsd: 200,
        inProgressLimit: 3,
        awaitingReviewAmberDays: 5,
        releaseWindow: null,
        autoReleaseHeldPaths: [...AUTO_RELEASE_HELD_PATHS_DEFAULT],
      });
    });

    it('reads the row, and a null held-path list means the defaults', async () => {
      const settings = await serviceWith({
        roadmapV2Enabled: true,
        planCeilingUsd: '150.0000',
        maxLeadCeilingUsd: '250.0000',
        inProgressLimit: 4,
        awaitingReviewAmberDays: 7,
        releaseWindow: { startHour: 22, endHour: 6, timezone: 'Asia/Kolkata' },
        autoReleaseHeldPaths: null,
      }).getRoadmapV2();
      expect(settings.enabled).toBe(true);
      expect(settings.ceilingUsd).toBe(150);
      expect(settings.maxLeadCeilingUsd).toBe(250);
      expect(settings.inProgressLimit).toBe(4);
      expect(settings.awaitingReviewAmberDays).toBe(7);
      expect(settings.releaseWindow).toEqual({
        startHour: 22,
        endHour: 6,
        timezone: 'Asia/Kolkata',
      });
      expect(settings.autoReleaseHeldPaths).toEqual([
        ...AUTO_RELEASE_HELD_PATHS_DEFAULT,
      ]);
    });

    it('answers 404 from assertRoadmapV2 while the flag is off', async () => {
      await expect(
        serviceWith({ roadmapV2Enabled: false }).assertRoadmapV2(),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
