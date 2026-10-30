import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioSessionReviewController } from './review.controller';
import { ScenarioSessionReviewService } from '../service/review.service';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';

describe('ScenarioSessionReviewController', () => {
  let controller: ScenarioSessionReviewController;

  const mockReviewService = {
    getUnreadReviewCount: jest.fn(),
  };

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  const mockPermissionValidator = {
    validatePermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioSessionReviewController],
      providers: [
        {
          provide: ScenarioSessionReviewService,
          useValue: mockReviewService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: PermissionValidator,
          useValue: mockPermissionValidator,
        },
        PermissionsGuard,
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 1 };
          return true;
        },
      })
      .compile();

    controller = module.get<ScenarioSessionReviewController>(
      ScenarioSessionReviewController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnreadReviewCount', () => {
    it('should return { count: 0 } if user does not have permission', async () => {
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);
      const req = { user: { id: 1 } };
      const result = await controller.getUnreadReviewCount(req as any);
      expect(result).toEqual({ count: 0 });
      expect(mockReviewService.getUnreadReviewCount).not.toHaveBeenCalled();
    });

    it('should return the count if user has permission', async () => {
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      mockReviewService.getUnreadReviewCount.mockResolvedValue({ count: 10 });
      const req = { user: { id: 1 } };
      const result = await controller.getUnreadReviewCount(req as any);
      expect(result).toEqual({ count: 10 });
      expect(mockReviewService.getUnreadReviewCount).toHaveBeenCalled();
    });
  });
});