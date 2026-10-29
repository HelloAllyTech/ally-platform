import { Test, TestingModule } from '@nestjs/testing';
import { ScribeSessionReviewController } from './review.controller';
import { ScribeSessionReviewService } from '../service/review.service';
import { AuthGuard } from '@nestjs/passport';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewReadStatusRepository } from '../repository/read-status.repository';
import { ChatSharedService } from 'src/chat/service/chat-shared.service';
import { ScribeSessionReviewThreadRepository } from '../repository/thread.repository';
import { ScribeSessionReviewReactionRepository } from '../repository/reaction.repository';
import { UserService } from 'src/user/service/user.service';
import { ScribeReviewAccessValidator } from '../util/scribe-review-access-validator';
import { ScribeSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScribeSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';
import { User } from 'src/user/entity/user.entity';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';

describe('ScribeSessionReviewController', () => {
  let controller: ScribeSessionReviewController;
  let reviewService: ScribeSessionReviewService;
  let permissionValidator: PermissionValidator;

  const mockUser = { id: 1 } as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScribeSessionReviewController],
      providers: [
        {
          provide: ScribeSessionReviewService,
          useValue: { getUnreadReviewCount: jest.fn() },
        },
        {
          provide: PermissionValidator,
          useValue: { validatePermissions: jest.fn() },
        },
        { provide: ScribeSessionReviewRepository, useValue: {} },
        { provide: ScribeSessionReviewReadStatusRepository, useValue: {} },
        { provide: ChatSharedService, useValue: {} },
        { provide: ScribeSessionReviewThreadRepository, useValue: {} },
        { provide: ScribeSessionReviewReactionRepository, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: ScribeReviewAccessValidator, useValue: {} },
        { provide: ScribeSessionReviewCommentRepository, useValue: {} },
        { provide: ScribeSessionReviewCommentReactionRepository, useValue: {} },
        {
          provide: PermissionsService,
          useValue: { getUserPermissions: jest.fn() },
        },
        PermissionsGuard,
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = mockUser;
          return true;
        },
      })
      .compile();

    controller = module.get<ScribeSessionReviewController>(
      ScribeSessionReviewController,
    );
    reviewService = module.get<ScribeSessionReviewService>(
      ScribeSessionReviewService,
    );
    permissionValidator = module.get<PermissionValidator>(PermissionValidator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnreadReviewCount', () => {
    it('should return unread count for user with permission', async () => {
      (permissionValidator.validatePermissions as jest.Mock).mockResolvedValue(
        true,
      );
      (reviewService.getUnreadReviewCount as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const result = await controller.getUnreadReviewCount(mockUser);

      expect(result).toEqual({ count: 5 });
      expect(permissionValidator.validatePermissions).toHaveBeenCalled();
      expect(reviewService.getUnreadReviewCount).toHaveBeenCalled();
    });

    it('should return { count: 0 } for user without permission', async () => {
      (permissionValidator.validatePermissions as jest.Mock).mockResolvedValue(
        false,
      );

      const result = await controller.getUnreadReviewCount(mockUser);

      expect(result).toEqual({ count: 0 });
      expect(permissionValidator.validatePermissions).toHaveBeenCalled();
      expect(reviewService.getUnreadReviewCount).not.toHaveBeenCalled();
    });
  });
});
