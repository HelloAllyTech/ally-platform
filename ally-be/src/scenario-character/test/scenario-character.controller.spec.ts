import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioCharacterController } from '../controller/scenario-character.controller';
import { ScenarioCharacterService } from '../service/scenario-character.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FeatureToggleGuard } from '../../auth/guards/feature-toggle.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { TenantFeatureService } from '../../authorization/service/tenant-feature.service';
import { TenantScopeService } from '../../authorization/service/tenant-scope.service';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../../authorization/service/permissions.service';

describe('ScenarioCharacterController', () => {
  let controller: ScenarioCharacterController;
  let featureToggleGuard: FeatureToggleGuard;

  const mockPermissionsService = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const mockScenarioCharacterService = {
    createScenarioCharacter: jest.fn(),
  };

  const mockFeatureToggleService = {
    hasToggle: jest.fn().mockResolvedValue(false),
    isWithheld: jest.fn().mockResolvedValue(false),
  };

  const mockTenantFeatureService = {
    isEnabledForTenant: jest.fn().mockResolvedValue(false),
  };

  const mockTenantScopeService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      controllers: [ScenarioCharacterController],
      providers: [
        {
          provide: ScenarioCharacterService,
          useValue: mockScenarioCharacterService,
        },
        ConfigService,
        Reflector,
        FeatureToggleGuard,
        {
          provide: PermissionsGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        { provide: PermissionsService, useValue: mockPermissionsService },
        {
          provide: FeatureToggleService,
          useValue: mockFeatureToggleService,
        },
        {
          provide: TenantFeatureService,
          useValue: mockTenantFeatureService,
        },
        {
          provide: TenantScopeService,
          useValue: mockTenantScopeService,
        },
      ],
    }).compile();

    controller = module.get<ScenarioCharacterController>(
      ScenarioCharacterController,
    );
    featureToggleGuard = module.get<FeatureToggleGuard>(FeatureToggleGuard);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createScenarioCharacter', () => {
    it('should throw a helpful error when feature is not enabled', async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 1, tenantId: 'some-tenant' },
          }),
        }),
        getHandler: () => controller.createScenarioCharacter,
        getClass: () => ScenarioCharacterController,
      } as unknown as ExecutionContext;

      await expect(featureToggleGuard.canActivate(mockContext)).rejects.toThrow(
        ForbiddenException,
      );

      try {
        await featureToggleGuard.canActivate(mockContext);
      } catch (error) {
        expect(error.response.message).toEqual(
          'The Character Library feature is not enabled for your organization. Please contact an administrator to enable it.',
        );
      }
    });
  });
});
