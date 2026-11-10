import { Test, TestingModule } from '@nestjs/testing';
import { BugHunterPipelineController } from '../bug-hunter-pipeline.controller';
import { BugHunterService } from '../../service/bug-hunter.service';
import { BugFindingService } from '../../service/bug-finding.service';
import { BugHunterFinderDataService } from '../../service/bug-hunter-finder-data.service';
import { BugFixSessionService } from '../../service/bug-fix-session.service';
import { BugHuntRunRepository } from '../../repository/bug-hunt-run.repository';
import { AppConfigService } from 'src/config/config.service';
import { BugHunterModelSettingsService } from '../../service/bug-hunter-model-settings.service';
import { BugHunterTelemetryService } from '../../service/bug-hunter-telemetry.service';
import { BugHunterEvalService } from '../../service/bug-hunter-eval.service';
import { BugHunterPolicyService } from '../../service/bug-hunter-policy.service';
import { ContextAgentChunkService } from 'src/context-library/service/context-agent-chunk.service';
import { BugHunterDossierService } from '../../service/bug-hunter-dossier.service';
import { BugCaseFileService } from '../../service/bug-case-file.service';
import { BugVerifyFixService } from '../../service/bug-verify-fix.service';
import { BugVerifyFindingsService } from '../../service/bug-verify-findings.service';
import { BugHunterFinderService } from '../../service/bug-hunter-finder.service';
import { BugFixStudyService } from '../../service/bug-fix-study.service';
import { BugHunterOrchestratorService } from '../../service/bug-hunter-orchestrator.service';
import { SearchBugHunterMemoryQueryDto } from '../../dto/bug-hunter-memory.dto';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { ValidationPipe } from '@nestjs/common';
import { BugHunterProbeService } from '../../service/bug-hunter-probe.service';
import { BugHunterKnowledgeService } from '../../service/bug-hunter-knowledge.service';
import { BugHunterPrecedentService } from '../../service/bug-hunter-precedent.service';
import { BugHunterFeatureMapService } from '../../service/bug-hunter-feature-map.service';

describe('BugHunterPipelineController', () => {
  let controller: BugHunterPipelineController;
  let notes: ContextAgentChunkService;
  let bugFindingService: BugFindingService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [BugHunterPipelineController],
      providers: [
        {
          provide: BugHunterProbeService,
          useValue: { catalogue: jest.fn(), run: jest.fn() },
        },
        {
          provide: BugHunterKnowledgeService,
          useValue: {
            forFinding: jest.fn().mockResolvedValue({
              playbooks: [],
              precedents: [],
              featureCards: [],
            }),
          },
        },
        {
          provide: BugHunterPrecedentService,
          useValue: { similar: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: BugHunterFeatureMapService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            forBug: jest.fn().mockResolvedValue([]),
            save: jest.fn(),
          },
        },

        { provide: BugHunterService, useValue: {} },
        { provide: BugFindingService, useValue: { setStatus: jest.fn() } },
        { provide: BugHunterFinderDataService, useValue: {} },
        {
          provide: BugFixSessionService,
          useValue: { deleteBranchAfterAgentMerge: jest.fn() },
        },
        { provide: AppConfigService, useValue: {} },
        { provide: BugHunterModelSettingsService, useValue: {} },
        {
          provide: BugHunterTelemetryService,
          useValue: { timed: jest.fn((_runId, _kind, fn) => fn()) },
        },
        { provide: BugHunterEvalService, useValue: {} },
        {
          provide: BugHunterPolicyService,
          useValue: { assertTransitionAllowed: jest.fn() },
        },
        {
          provide: ContextAgentChunkService,
          useValue: {
            search: jest.fn(),
            writeAgentChunk: jest.fn(),
            recordFeedback: jest.fn(),
          },
        },
        { provide: BugHunterDossierService, useValue: { build: jest.fn() } },
        { provide: BugCaseFileService, useValue: { build: jest.fn() } },
        {
          provide: BugVerifyFixService,
          useValue: { dispatch: jest.fn(), recordVerdict: jest.fn() },
        },
        {
          provide: BugVerifyFindingsService,
          useValue: { dispatchForRun: jest.fn(), recordVerdict: jest.fn() },
        },
        {
          provide: BugHunterFinderService,
          useValue: { ensurePlan: jest.fn(), triageNew: jest.fn() },
        },
        {
          provide: BugHuntRunRepository,
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        { provide: BugFixStudyService, useValue: { record: jest.fn() } },
        {
          provide: BugHunterOrchestratorService,
          useValue: { onSessionFailed: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<BugHunterPipelineController>(
      BugHunterPipelineController,
    );
    notes = module.get<ContextAgentChunkService>(ContextAgentChunkService);
    bugFindingService = module.get<BugFindingService>(BugFindingService);
  });

  describe('patchFinding when the agent reports its own merge', () => {
    const merged = {
      id: 'finding-2',
      repo: 'ally-ai-learn',
      prUrl: 'https://github.com/helloallytech/ally-ai-learn/pull/255',
      status: BugFindingStatus.MERGED,
      title: 't',
      description: 'd',
      metadata: {},
    };

    it('asks the session service to delete the branch as a backstop to --delete-branch (OPP-0750)', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(merged);
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);

      await controller.patchFinding('finding-2', {
        status: BugFindingStatus.MERGED,
      });

      expect(sessions.deleteBranchAfterAgentMerge).toHaveBeenCalledWith(merged);
    });

    it('still returns the finding when the branch delete throws', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(merged);
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);
      (sessions.deleteBranchAfterAgentMerge as jest.Mock).mockRejectedValue(
        new Error('GitHub down'),
      );

      const dto = await controller.patchFinding('finding-2', {
        status: BugFindingStatus.MERGED,
      });

      expect(dto.status).toBe(BugFindingStatus.MERGED);
    });

    it('does not touch GitHub for any other status', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue({
        ...merged,
        status: BugFindingStatus.PR_OPENED,
      });
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);

      await controller.patchFinding('finding-2', {
        status: BugFindingStatus.PR_OPENED,
        prUrl: merged.prUrl,
      });

      expect(sessions.deleteBranchAfterAgentMerge).not.toHaveBeenCalled();
    });
  });

  describe('patchFinding with a post-mortem', () => {
    const failed = {
      id: 'finding-1',
      repo: 'ally-be',
      runId: 'run-1',
      status: BugFindingStatus.FAILED,
      title: 't',
      description: 'd',
      metadata: {},
    };

    it('writes a repo gotcha into the notebook as a candidate, tagged so the curator knows where it came from', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);

      await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 2,
          failingCheck: 'full suite',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
          repoGotcha: '  scheduler specs need a live Redis on the runner ',
        },
      });

      expect(notes.writeAgentChunk).toHaveBeenCalledWith({
        collection: 'bug_hunter_notes',
        agent: 'bug_hunter',
        statement: 'ally-be: scheduler specs need a live Redis on the runner',
        repos: ['ally-be'],
        facets: { tags: ['fix-gotcha', 'postmortem'] },
        evidence: { runId: 'run-1', findingId: 'finding-1' },
      });
    });

    it('writes nothing to the notebook when the post-mortem names no repo gotcha', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);

      await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 1,
          failingCheck: 'regression test',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
        },
      });

      expect(notes.writeAgentChunk).not.toHaveBeenCalled();
    });

    it('still returns the finding when the notebook write fails — the failure was already recorded', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);
      (notes.writeAgentChunk as jest.Mock).mockRejectedValue(
        new Error('ally-ai down'),
      );

      const dto = await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 1,
          failingCheck: 'c',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
          repoGotcha: 'g',
        },
      });

      expect(dto.id).toBe('finding-1');
    });
  });

  describe('memoryFeedback (OPP-0752)', () => {
    it('records the counters and marks the run as having reported, so an empty list still counts', async () => {
      (notes.recordFeedback as jest.Mock).mockResolvedValue({
        applied: 0,
        contradicted: 0,
        unused: 4,
      });
      const runs = module.get<BugHuntRunRepository>(
        BugHuntRunRepository,
      ) as any;
      runs.findOne.mockResolvedValue({
        id: 'run-1',
        metadata: { breadth: { commits: 3 } },
      });

      const result = await controller.memoryFeedback({
        runId: 'run-1',
        applied: [],
      });

      expect(result).toEqual({ applied: 0, contradicted: 0 });
      // The run is the session: what it was shown and did not apply is marked unused.
      expect(notes.recordFeedback).toHaveBeenCalledWith({
        useCase: 'bug_hunter',
        collection: 'bug_hunter_notes',
        sessionId: 'run-1',
        applied: [],
        contradicted: [],
      });
      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'run-1',
          metadata: expect.objectContaining({
            breadth: { commits: 3 },
            memoryFeedback: expect.objectContaining({
              applied: 0,
              contradicted: 0,
            }),
          }),
        }),
      );
    });
  });

  describe('searchMemory', () => {
    it('should handle `limit` as a string and convert it to a number', async () => {
      const query = {
        q: 'test',
        repo: 'ally-be',
        limit: '3',
      };

      const validationPipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      const dto = new SearchBugHunterMemoryQueryDto();
      dto.q = query.q;
      dto.repo = query.repo;
      dto.limit = Number(query.limit);

      await validationPipe.transform(dto, { type: 'query' });

      (notes.search as jest.Mock).mockResolvedValue([]);

      await controller.searchMemory(dto);

      expect(notes.search).toHaveBeenCalledWith(
        expect.objectContaining({
          useCase: 'bug_hunter',
          collection: 'bug_hunter_notes',
          repos: ['ally-be'],
          limit: 3,
        }),
      );
    });
  });
});
