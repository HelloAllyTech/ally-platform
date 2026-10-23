import { Test, TestingModule } from '@nestjs/testing';
import { BuilderController } from './builder.controller';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderInterviewOrchestratorService } from '../service/builder-interview-orchestrator.service';
import { BuilderBuildService } from '../service/builder-build.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderNotificationService } from '../service/builder-notification.service';
import { BuilderLessonCuratorService } from '../service/builder-lesson-curator.service';
import { BuilderExemplarService } from '../service/builder-exemplar.service';
import { BuilderMetricsService } from '../service/builder-metrics.service';
import { BuilderEpicService } from '../service/builder-epic.service';
import { BuilderResearchService } from '../service/builder-research.service';
import { BuilderPrdVersionRepository } from '../repository/builder-prd.repository';
import { BuilderBuildRunRepository } from '../repository/builder-build.repository';
import { BuilderCatalogService } from '../service/builder-catalog.service';
import { BuilderEvidenceLogService } from '../service/builder-evidence-log.service';
import { BuilderSessionStatus } from '../enum/builder.enum';
import { BuilderSessionSummaryDto } from '../dto/builder.dto';
import { TokenUser } from 'src/auth/type/auth.types';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { RedisService } from 'src/redis/service/redis.service';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';

describe('BuilderController', () => {
  let controller: BuilderController;
  let sessionService: {
    listSessions: jest.Mock;
    listArchivedSessions: jest.Mock;
    getSession: jest.Mock;
  };

  beforeEach(async () => {
    sessionService = {
      listSessions: jest.fn(),
      listArchivedSessions: jest.fn(),
      getSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuilderController],
      providers: [
        { provide: BuilderSessionService, useValue: sessionService },
        { provide: BuilderPrdService, useValue: {} },
        { provide: BuilderKnowledgeService, useValue: {} },
        { provide: BuilderInterviewOrchestratorService, useValue: {} },
        { provide: BuilderBuildService, useValue: {} },
        { provide: BuilderEventService, useValue: {} },
        { provide: BuilderPullRequestService, useValue: {} },
        { provide: BuilderSettingsService, useValue: {} },
        { provide: BuilderNotificationService, useValue: {} },
        { provide: BuilderLessonCuratorService, useValue: {} },
        { provide: BuilderExemplarService, useValue: {} },
        { provide: BuilderMetricsService, useValue: {} },
        { provide: BuilderEpicService, useValue: {} },
        { provide: BuilderResearchService, useValue: {} },
        { provide: BuilderPrdVersionRepository, useValue: {} },
        { provide: BuilderBuildRunRepository, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: BuilderCatalogService, useValue: {} },
        { provide: BuilderEvidenceLogService, useValue: {} },
        {
          provide: PermissionsService,
          useValue: { getUserPermissions: jest.fn() },
        },
        { provide: FeatureToggleService, useValue: { isEnabled: jest.fn() } },
        {
          provide: TenantFeatureService,
          useValue: { isEnabledForTenant: jest.fn() },
        },
        { provide: TenantScopeService, useValue: { resolveScope: jest.fn() } },
      ],
    }).compile();

    controller = module.get<BuilderController>(BuilderController);
  });

  describe('listSessions', () => {
    const user: TokenUser = { id: 1, tenantId: 'tenant-1', roles: [] } as any;

    it('returns a list of session summary DTOs including the model field', async () => {
      const sessions = [
        {
          id: 'session-1',
          title: 'Test Session',
          status: BuilderSessionStatus.INTERVIEWING,
          model: 'gpt-4o',
          totalCostUsd: '0.0000',
          updatedAt: new Date(),
          createdBy: 1,
          createdByName: 'Test User',
        },
      ];
      sessionService.listSessions.mockResolvedValue(sessions);

      const result = (await controller.listSessions(
        { mine: false },
        user,
      )) as BuilderSessionSummaryDto[];

      expect(result).toBeInstanceOf(Array);
      expect(result[0]).toBeInstanceOf(BuilderSessionSummaryDto);
      expect(result[0].model).toBe('gpt-4o');
    });

    it('returns null for model when not set', async () => {
      const sessions = [
        {
          id: 'session-1',
          title: 'Test Session',
          status: BuilderSessionStatus.INTERVIEWING,
          model: null,
          totalCostUsd: '0.0000',
          updatedAt: new Date(),
          createdBy: 1,
          createdByName: 'Test User',
        },
      ];
      sessionService.listSessions.mockResolvedValue(sessions);

      const result = (await controller.listSessions(
        { mine: false },
        user,
      )) as BuilderSessionSummaryDto[];

      expect(result[0].model).toBeNull();
    });
  });
});
