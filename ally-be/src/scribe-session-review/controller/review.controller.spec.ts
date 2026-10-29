import { Test, TestingModule } from '@nestjs/testing';
import { ScribeSessionReviewController } from './review.controller';
import { ScribeSessionReviewService } from '../service/review.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';

describe('ScribeSessionReviewController', () => {
  let controller: ScribeSessionReviewController;

  const mockReviewService = {
    getUnreadReviewCount: jest.fn(() => Promise.resolve({ count: 5 })),
  };

  const mockPermissionValidator = {
    validatePermissions: jest.fn(),
  };

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScribeSessionReviewController],
      providers: [
        {
          provide: ScribeSessionReviewService,
          useValue: mockReviewService,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidator,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        PermissionsGuard,
        Reflector,
      ],
    }).compile();

    controller = module.get<ScribeSessionReviewController>(
      ScribeSessionReviewController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnreadReviewCount', () => {
    it('should return unread count for user with permission', async () => {
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      const req = { user: { id: 1 } };
      const result = await controller.getUnreadReviewCount(req as any);
      expect(mockPermissionValidator.validatePermissions).toHaveBeenCalledWith(
        1,
        [PERMISSIONS.VIEW_SCRIBE_REVIEWS],
      );
      expect(mockReviewService.getUnreadReviewCount).toHaveBeenCalled();
      expect(result).toEqual({ count: 5 });
    });

    it('should return 0 for user without permission', async () => {
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);
      const req = { user: { id: 2 } };
      const result = await controller.getUnreadReviewCount(req as any);
      expect(mockPermissionValidator.validatePermissions).toHaveBeenCalledWith(
        2,
        [PERMISSIONS.VIEW_SCRIBE_REVIEWS],
      );
      expect(mockReviewService.getUnreadReviewCount).not.toHaveBeenCalled();
      expect(result).toEqual({ count: 0 });
    });
  });
});
