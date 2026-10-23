import { ForbiddenException } from '@nestjs/common';
import {
  AuthoredContentType,
  ContentAccessService,
} from '../content-access.service';
import { FeatureToggleKey } from '../../constants/admin-feature-toggle.constants';

describe('ContentAccessService — per-admin content visibility and authoring', () => {
  const ADMIN_ID = 7;
  const COLLEAGUE_ID = 8;

  let toggles: Set<string>;
  let platformTier: boolean;
  let featureToggleService: {
    isPlatformTierAdmin: jest.Mock;
    hasToggle: jest.Mock;
  };
  let service: ContentAccessService;

  beforeEach(() => {
    toggles = new Set();
    platformTier = true;
    featureToggleService = {
      isPlatformTierAdmin: jest.fn(async () => platformTier),
      hasToggle: jest.fn(async (_userId: number, key: string) =>
        toggles.has(key),
      ),
    };
    service = new ContentAccessService(featureToggleService as any);
  });

  describe('visibility (See All Content)', () => {
    it('narrows a platform admin without the toggle to their own content', async () => {
      await expect(service.ownerFilterFor(ADMIN_ID)).resolves.toBe(ADMIN_ID);
      await expect(service.canSee(ADMIN_ID, ADMIN_ID)).resolves.toBe(true);
      await expect(service.canSee(COLLEAGUE_ID, ADMIN_ID)).resolves.toBe(false);
    });

    it('hides content with no recorded creator from them too', async () => {
      await expect(service.canSee(null, ADMIN_ID)).resolves.toBe(false);
    });

    it('shows everything once the toggle is on', async () => {
      toggles.add(FeatureToggleKey.CONTENT_VIEW_ALL);

      await expect(service.ownerFilterFor(ADMIN_ID)).resolves.toBeNull();
      await expect(service.canSee(COLLEAGUE_ID, ADMIN_ID)).resolves.toBe(true);
    });

    it('never narrows a tenant ADMIN on the same endpoints', async () => {
      platformTier = false;

      await expect(service.ownerFilterFor(ADMIN_ID)).resolves.toBeNull();
      expect(featureToggleService.hasToggle).not.toHaveBeenCalled();
    });

    it('never narrows a call with no user (service-to-service)', async () => {
      await expect(service.ownerFilterFor(undefined)).resolves.toBeNull();
    });

    it('refuses to open a colleague’s content, naming the toggle to ask for', async () => {
      await expect(
        service.assertCanSee(
          AuthoredContentType.COURSE,
          COLLEAGUE_ID,
          ADMIN_ID,
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'You can only open courses you created. ' +
            'Ask whoever manages admin access to turn on See All Content for you.',
        ),
      );
    });
  });

  describe('authoring (Create Roleplays / Cases / Courses)', () => {
    it.each([
      [AuthoredContentType.ROLEPLAY, FeatureToggleKey.CREATE_ROLEPLAYS],
      [AuthoredContentType.CASE, FeatureToggleKey.CREATE_CASES],
      [AuthoredContentType.COURSE, FeatureToggleKey.CREATE_COURSES],
    ])('reads %s authoring from %s', async (type, key) => {
      await expect(service.canAuthor(type, ADMIN_ID)).resolves.toBe(false);
      toggles.add(key);
      await expect(service.canAuthor(type, ADMIN_ID)).resolves.toBe(true);
    });

    it('has no toggle for tracks, so they stay writable', async () => {
      await expect(
        service.canAuthor(AuthoredContentType.TRACK, ADMIN_ID),
      ).resolves.toBe(true);
    });

    it('does not apply to anyone outside the platform tier', async () => {
      platformTier = false;

      await expect(
        service.canAuthor(AuthoredContentType.ROLEPLAY, ADMIN_ID),
      ).resolves.toBe(true);
    });

    it('makes the type view-only: own content cannot be changed either', async () => {
      toggles.add(FeatureToggleKey.CONTENT_VIEW_ALL);

      await expect(
        service.assertCanModify(AuthoredContentType.CASE, ADMIN_ID, ADMIN_ID),
      ).rejects.toThrow(
        new ForbiddenException(
          'You can view cases but not create or change them. ' +
            'Ask whoever manages admin access to turn on Create Cases for you.',
        ),
      );
    });

    it('needs both halves to change an item: authoring on, and the item in view', async () => {
      toggles.add(FeatureToggleKey.CREATE_ROLEPLAYS);

      await expect(
        service.assertCanModify(
          AuthoredContentType.ROLEPLAY,
          ADMIN_ID,
          ADMIN_ID,
        ),
      ).resolves.toBeUndefined();
      await expect(
        service.assertCanModify(
          AuthoredContentType.ROLEPLAY,
          COLLEAGUE_ID,
          ADMIN_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
