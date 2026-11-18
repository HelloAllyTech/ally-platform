import { ForbiddenException } from '@nestjs/common';
import { PLATFORM_WIDE_ONLY_MESSAGE } from 'src/authorization/service/tenant-scope.service';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import type { RoadmapRole } from '../../util/roadmap-role.util';
import { PlanAccessService } from '../plan-access.service';

describe('PlanAccessService', () => {
  const AUTHOR = 1;
  const LEAD = 2;
  const OTHER = 3;

  const build = (roles: Record<number, RoadmapRole>) =>
    new PlanAccessService({
      roleOf: jest.fn(async (userId: number) => roles[userId] ?? 'none'),
    } as never);

  const bodyOf = (error: unknown) =>
    (error as ForbiddenException).getResponse() as Record<string, unknown>;

  describe('assertIdeas / assertLead', () => {
    it('passes a holder of the role, or a higher one (the roles nest)', async () => {
      await expect(
        build({ [AUTHOR]: 'idea' }).assertIdeas(AUTHOR),
      ).resolves.toBeUndefined();
      await expect(
        build({ [LEAD]: 'builder' }).assertLead(LEAD),
      ).resolves.toBeUndefined();
      await expect(
        build({ [LEAD]: 'builder' }).assertIdeas(LEAD),
      ).resolves.toBeUndefined();
      await expect(
        build({ [OTHER]: 'owner' }).assertLead(OTHER),
      ).resolves.toBeUndefined();
    });

    it('refuses with FEATURE_NOT_ENABLED naming the role', async () => {
      const error = await build({})
        .assertIdeas(AUTHOR)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(bodyOf(error).errorCode).toBe('FEATURE_NOT_ENABLED');
      expect(String(bodyOf(error).message)).toContain('Idea role');
    });

    it('needs the Builder role to lead', async () => {
      const idea = build({ [AUTHOR]: 'idea' });
      expect(await idea.canLead(AUTHOR)).toBe(false);
      const error = await idea.assertLead(AUTHOR).catch((e: unknown) => e);
      expect(String(bodyOf(error).message)).toContain('Builder role');
    });

    it('explains an org-restricted refusal as platform-only', async () => {
      const access = build({ [AUTHOR]: 'viewer' });
      expect(await access.canIdeas(AUTHOR)).toBe(false);
      for (const call of [
        access.assertIdeas(AUTHOR),
        access.assertLead(AUTHOR),
      ]) {
        const error = await call.catch((e: unknown) => e);
        expect(bodyOf(error).message).toBe(PLATFORM_WIDE_ONLY_MESSAGE);
      }
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

    it('lets an author read their own plan even with no role at all', async () => {
      const access = build({});
      expect(await access.canRead(privatePlan, AUTHOR)).toBe(true);
      expect(await access.canRead(sharedPlan, AUTHOR)).toBe(true);
    });

    it('never shows a private draft to anyone else, Builders included', async () => {
      expect(
        await build({ [LEAD]: 'builder' }).canRead(privatePlan, LEAD),
      ).toBe(false);
    });

    it('shows a shared plan to Builders and Owners only', async () => {
      const access = build({
        [LEAD]: 'builder',
        [OTHER]: 'idea',
        4: 'owner',
      });
      expect(await access.canRead(sharedPlan, LEAD)).toBe(true);
      expect(await access.canRead(sharedPlan, 4)).toBe(true);
      expect(await access.canRead(sharedPlan, OTHER)).toBe(false);
    });
  });

  describe('canEdit', () => {
    it('lets the author edit a private draft only while they hold the Idea role', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.PRIVATE,
      };
      expect(await build({ [AUTHOR]: 'idea' }).canEdit(plan, AUTHOR)).toBe(
        true,
      );
      expect(await build({}).canEdit(plan, AUTHOR)).toBe(false);
      expect(await build({ [OTHER]: 'builder' }).canEdit(plan, OTHER)).toBe(
        false,
      );
    });

    it('lets only the current lead edit a shared plan', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
        leadUserId: LEAD,
      };
      const access = build({
        [AUTHOR]: 'builder',
        [LEAD]: 'builder',
        [OTHER]: 'builder',
      });
      expect(await access.canEdit(plan, LEAD)).toBe(true);
      expect(await access.canEdit(plan, AUTHOR)).toBe(false);
      expect(await access.canEdit(plan, OTHER)).toBe(false);
    });

    it('lets a lead who lost the Builder role edit nothing', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
        leadUserId: LEAD,
      };
      expect(await build({ [LEAD]: 'idea' }).canEdit(plan, LEAD)).toBe(false);
    });

    it('lets nobody edit a shared plan nobody has taken on', async () => {
      const plan = {
        createdBy: AUTHOR,
        visibility: BuilderSessionVisibility.SHARED,
      };
      expect(await build({ [AUTHOR]: 'owner' }).canEdit(plan, AUTHOR)).toBe(
        false,
      );
    });
  });
});
