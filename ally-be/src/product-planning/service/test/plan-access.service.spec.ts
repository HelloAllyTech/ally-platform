import { ForbiddenException } from '@nestjs/common';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PLATFORM_WIDE_ONLY_MESSAGE } from 'src/authorization/service/tenant-scope.service';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanAccessService } from '../plan-access.service';

describe('PlanAccessService', () => {
  const AUTHOR = 1;
  const LEAD = 2;
  const OTHER = 3;

  const build = (
    toggles: Record<number, FeatureToggleKey[]>,
    options: { withheld?: number[] } = {},
  ) => {
    const featureToggleService = {
      hasToggle: jest.fn(async (userId: number, key: FeatureToggleKey) =>
        (toggles[userId] ?? []).includes(key),
      ),
      isWithheld: jest.fn(async (userId: number) =>
        (options.withheld ?? []).includes(userId),
      ),
      isRestricted: jest.fn(async (userId: number) =>
        (options.withheld ?? []).includes(userId),
      ),
    };
    return new PlanAccessService(featureToggleService as never);
  };

  const IDEAS = FeatureToggleKey.PRODUCT_PLANNING_IDEAS;
  const LEAD_KEY = FeatureToggleKey.PRODUCT_PLANNING_LEAD;

  describe('assertIdeas / assertLead', () => {
    it('passes a holder', async () => {
      await expect(
        build({ [AUTHOR]: [IDEAS] }).assertIdeas(AUTHOR),
      ).resolves.toBeUndefined();
      await expect(
        build({ [LEAD]: [LEAD_KEY] }).assertLead(LEAD),
      ).resolves.toBeUndefined();
    });

    it('refuses with FEATURE_NOT_ENABLED naming the toggle', async () => {
      const error = await build({})
        .assertIdeas(AUTHOR)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.errorCode).toBe('FEATURE_NOT_ENABLED');
      expect(body.featureKey).toBe(IDEAS);
      expect(String(body.message)).toContain('Product Planning — Ideas');
    });

    it('refuses Ideas to an org-restricted admin even though they hold it by default', async () => {
      const access = build({ [AUTHOR]: [IDEAS] }, { withheld: [AUTHOR] });
      expect(await access.canIdeas(AUTHOR)).toBe(false);
      const error = await access.assertIdeas(AUTHOR).catch((e: unknown) => e);
      const body = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.message).toBe(PLATFORM_WIDE_ONLY_MESSAGE);
    });

    it('explains an org-restricted refusal as platform-only', async () => {
      const error = await build({}, { withheld: [AUTHOR] })
        .assertLead(AUTHOR)
        .catch((e: unknown) => e);
      const body = (error as ForbiddenException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.message).toBe(PLATFORM_WIDE_ONLY_MESSAGE);
    });
  });

  describe('canRead', () => {
    const privatePlan = {
      createdBy: AUTHOR,
      visibility: BuilderSessionVisibility.PRIVATE,
    };
    const sharedPlan = {
      createdBy: AUTHOR,
      visibility: BuilderSessionVisibility.SHARED,
      leadUserId: LEAD,
    };

    it('lets an author read their own plan even with no toggle at all', async () => {
      const access = build({});
      expect(await access.canRead(privatePlan, AUTHOR)).toBe(true);
      expect(await access.canRead(sharedPlan, AUTHOR)).toBe(true);
    });

    it('never shows a private draft to anyone else, Leads included', async () => {
      expect(
        await build({ [LEAD]: [LEAD_KEY] }).canRead(privatePlan, LEAD),
      ).toBe(false);
    });

    it('shows a shared plan to Leads only', async () => {
      const access = build({ [LEAD]: [LEAD_KEY], [OTHER]: [IDEAS] });
      expect(await access.canRead(sharedPlan, LEAD)).toBe(true);
      expect(await access.canRead(sharedPlan, OTHER)).toBe(false);
    });
  });

  describe('canEdit', () => {
    it('lets the author edit a private draft only while they hold Ideas', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.PRIVATE,
      };
      expect(await build({ [AUTHOR]: [IDEAS] }).canEdit(plan, AUTHOR)).toBe(
        true,
      );
      expect(await build({}).canEdit(plan, AUTHOR)).toBe(false);
      expect(
        await build({ [OTHER]: [IDEAS, LEAD_KEY] }).canEdit(plan, OTHER),
      ).toBe(false);
    });

    it('lets only the current lead edit a shared plan', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
        leadUserId: LEAD,
      };
      const access = build({
        [AUTHOR]: [IDEAS, LEAD_KEY],
        [LEAD]: [LEAD_KEY],
        [OTHER]: [LEAD_KEY],
      });
      expect(await access.canEdit(plan, LEAD)).toBe(true);
      expect(await access.canEdit(plan, AUTHOR)).toBe(false);
      expect(await access.canEdit(plan, OTHER)).toBe(false);
    });

    it('lets a lead who lost the Lead toggle edit nothing', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
        leadUserId: LEAD,
      };
      expect(await build({}).canEdit(plan, LEAD)).toBe(false);
    });

    it('lets nobody edit a shared plan nobody has taken on', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
      };
      expect(
        await build({ [AUTHOR]: [IDEAS, LEAD_KEY] }).canEdit(plan, AUTHOR),
      ).toBe(false);
    });
  });
});
