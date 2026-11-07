import { Test, TestingModule } from '@nestjs/testing';
import { ScribeSessionReviewController } from './review.controller';
import { ScribeSessionReviewService } from '../service/review.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

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
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ScribeSessionReviewController>(
      ScribeSessionReviewController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnreadReviewCount', () => {
    it('should return unread count', async () => {
      const result = await controller.getUnreadReviewCount();
      expect(mockReviewService.getUnreadReviewCount).toHaveBeenCalled();
      expect(result).toEqual({ count: 5 });
    });
  });
});
