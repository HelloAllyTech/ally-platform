import { ScenarioSessionBehaviorInstructions } from 'src/learn/entity/scenario-session-behavior-instructions.entity';
import { AiService } from 'src/ai/service/ai.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioSessionService } from '../scenario-session.service';
import { ScenarioSessionRepository } from 'src/learn/repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from 'src/learn/repository/scenario-session-messages.repository';
import { ScenarioService } from '../scenario.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { RoomMetadataStoreService } from '../room-metadata-store.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScenarioSessionFeedbacks } from 'src/learn/entity/scenario-session-feedbacks.entity';
import { ScenarioSessionLifecycleEvent } from 'src/learn/entity/scenario-session-lifecycle-event.entity';
import { DataSource } from 'typeorm';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { SimulationCreditsService } from '../simulation-credits.service';
import { ScenarioTenantService } from '../scenario-tenant.service';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import { ScenarioVoicesRepository } from 'src/learn/repository/scenario-voices.repository';
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { BehaviorTranslationRepository } from 'src/learn/repository/behavior-translation.repository';
import { ScenarioBehaviorInstructionTranslationRepository } from 'src/learn/repository/scenario-behavior-instruction-translation.repository';
import { ScenarioEventsRepository } from 'src/learn/repository/scenario-events.repository';
import { ScenariosRepository } from 'src/learn/repository/scenario.repository';
import { ScenarioSessionRecordingService } from '../scenario-session-recording.service';
import { ScenarioSessionEvaluationService } from '../scenario-session-evaluation.service';
import { ScenarioSessionDetailsRepository } from '../../repository/scenario-session-details.repository';
import { GlossaryAdherenceService } from 'src/language/service/glossary-adherence.service';
import { TranscriptTranslationService } from 'src/transcript-translation/service/transcript-translation.service';
import { PreviewMonologueService } from '../preview-monologue.service';
import { PostHog } from 'posthog-node';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { RedisService } from 'src/redis/service/redis.service';
import { CohortVisibilityService } from 'src/cohort/service/cohort-visibility.service';
import { LearnerSupervisorMemoryService } from '../learner-supervisor-memory.service';
import { TrackItemCompletionLogic } from 'src/track/type/track.type';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(() => 'tenant-1'),
    getUserId: jest.fn(() => '7'),
    getExecutionId: jest.fn(() => 'exec-1'),
    setAuthContext: jest.fn(),
  },
}));

describe('ScenarioSessionService — participation logic', () => {
  let service: ScenarioSessionService;
  let trackProgressService: jest.Mocked<TrackProgressService>;
  let scenarioSessionRepository: any;
  let scenarioService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSessionService,
        {
          provide: ScenarioSessionRepository,
          useValue: {
            createScenarioSession: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            getScenarioSessions: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ScenarioSessionMessagesRepository,
          useValue: { exists: jest.fn() },
        },
        { provide: ScenarioService, useValue: { getAdminScenario: jest.fn() } },
        {
          provide: ScenarioSharedService,
          useValue: {
            getLanguageDetailsForScenarioSession: jest.fn().mockResolvedValue({
              enLanguageDetails: { id: 1, value: 'en' },
              languageDetails: { id: 1, value: 'en' },
            }),
            createRoomMetadata: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RoomMetadataStoreService,
          useValue: {
            prepareRoomMetadata: jest
              .fn()
              .mockResolvedValue({ roomPayload: {}, dispatchPayload: {} }),
          },
        },
        {
          provide: LiveKitService,
          useValue: {
            createRoom: jest.fn(),
            listRooms: jest.fn().mockResolvedValue([]),
            agentDispatch: jest.fn().mockResolvedValue({}),
            preMarkProactiveDispatch: jest.fn(),
          },
        },
        {
          provide: SessionEventSharedService,
          useValue: {
            getSessionEventsByScenarioId: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: getRepositoryToken(ScenarioSessionFeedbacks), useValue: {} },
        {
          provide: getRepositoryToken(ScenarioSessionLifecycleEvent),
          useValue: { insert: jest.fn() },
        },
        { provide: DataSource, useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: ScenarioTenantService, useValue: {} },
        {
          provide: CohortVisibilityService,
          useValue: { canAccess: jest.fn().mockResolvedValue(true) },
        },
        { provide: ScenarioPathSessionService, useValue: {} },
        { provide: PermissionValidator, useValue: {} },
        {
          provide: SimulationCreditsService,
          useValue: {
            getSimulationCredits: jest
              .fn()
              .mockResolvedValue({ consumedCredits: 0, creditLimit: 1000 }),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            simulationConcurrency: { maxConcurrentSimulations: 100 },
            livekit: { agentName: 'Agent' },
            simulationCredits: { lifespanSecondsPerCredit: 60 },
          },
        },
        { provide: ScenarioPathSharedService, useValue: {} },
        { provide: ScenarioVoicesRepository, useValue: {} },
        { provide: ScenarioSessionReviewSharedService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CaseSharedService, useValue: {} },
        { provide: CaseSessionService, useValue: {} },
        {
          provide: TrackProgressService,
          useValue: {
            validateRoleplayStart: jest.fn(),
            completeItem: jest.fn(),
          },
        },
        {
          provide: TrackMemoryService,
          useValue: {
            getPreviousTrackMemory: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: getRepositoryToken(ScenarioSessionBehaviorInstructions),
          useValue: {},
        },
        { provide: BehaviorTranslationRepository, useValue: {} },
        {
          provide: ScenarioBehaviorInstructionTranslationRepository,
          useValue: {},
        },
        { provide: ScenarioEventsRepository, useValue: {} },
        { provide: ScenariosRepository, useValue: {} },
        { provide: ScenarioSessionRecordingService, useValue: {} },
        { provide: SharedLanguageService, useValue: {} },
        { provide: SessionEventTranslationService, useValue: {} },
        { provide: TranscriptTranslationService, useValue: {} },
        { provide: ScenarioSessionEvaluationService, useValue: {} },
        { provide: ScenarioSessionDetailsRepository, useValue: {} },
        { provide: GlossaryAdherenceService, useValue: {} },
        { provide: PreviewMonologueService, useValue: {} },
        { provide: PostHog, useValue: { capture: jest.fn() } },
        {
          provide: TenantFeatureService,
          useValue: { isEnabledForTenant: jest.fn().mockResolvedValue(true) },
        },
        { provide: RedisService, useValue: {} },
        { provide: LearnerSupervisorMemoryService, useValue: {} },
      ],
    }).compile();

    service = module.get<ScenarioSessionService>(ScenarioSessionService);
    trackProgressService = module.get(TrackProgressService);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioService = module.get(ScenarioService);

    // Mock internal token generation
    (service as any).generateScenarioSessionToken = jest
      .fn()
      .mockResolvedValue('token');
  });

  it('completes the track item immediately when starting a PARTICIPATION-only roleplay', async () => {
    const trackItemProgressId = 'tip-1';
    const scenarioId = 123;
    const trackItem = {
      id: 'item-1',
      completionCriteria: {
        completionLogic: TrackItemCompletionLogic.PARTICIPATION,
      },
    };

    scenarioService.getAdminScenario.mockResolvedValue({
      id: scenarioId,
      metadata: { languageVoices: { 1: 'voice-1' } },
    });
    trackProgressService.validateRoleplayStart.mockResolvedValue(
      trackItem as any,
    );
    scenarioSessionRepository.createScenarioSession.mockResolvedValue({
      id: 'sess-1',
      roomId: 'room-1',
    });

    await service.startScenarioSession(7, {
      scenarioId,
      trackItemProgressId,
      languageId: 1,
    });

    expect(trackProgressService.completeItem).toHaveBeenCalledWith(
      trackItemProgressId,
      {},
    );
  });

  it('does not complete the track item immediately for other completion logics', async () => {
    const trackItemProgressId = 'tip-1';
    const scenarioId = 123;
    const trackItem = {
      id: 'item-1',
      completionCriteria: { completionLogic: TrackItemCompletionLogic.SCORE },
    };

    scenarioService.getAdminScenario.mockResolvedValue({
      id: scenarioId,
      metadata: { languageVoices: { 1: 'voice-1' } },
    });
    trackProgressService.validateRoleplayStart.mockResolvedValue(
      trackItem as any,
    );
    scenarioSessionRepository.createScenarioSession.mockResolvedValue({
      id: 'sess-1',
      roomId: 'room-1',
    });

    await service.startScenarioSession(7, {
      scenarioId,
      trackItemProgressId,
      languageId: 1,
    });

    expect(trackProgressService.completeItem).not.toHaveBeenCalled();
  });
});
