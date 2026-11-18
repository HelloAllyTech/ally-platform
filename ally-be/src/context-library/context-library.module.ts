import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from 'src/ai/ai.module';
import { AwsModule } from 'src/aws/aws.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { RedisModule } from 'src/redis/redis.module';
import { ContextLibraryMcpController } from './controller/context-library-mcp.controller';
import { ContextLibraryOrgController } from './controller/context-library-org.controller';
import { ContextLibraryController } from './controller/context-library.controller';
import {
  ClBulkUpload,
  ClChunkRelation,
  ClChunkSource,
  ClChunkVersion,
} from './entity/cl-chunk-links.entity';
import { ClChunk } from './entity/cl-chunk.entity';
import { ClCollection } from './entity/cl-collection.entity';
import {
  ClReaderKey,
  ClRetrieval,
  ClRetrievalHit,
  ClUsageEvent,
} from './entity/cl-retrieval.entity';
import {
  ClIngestSegment,
  ClSegmentRun,
} from './entity/cl-ingest-segment.entity';
import { ClRolloutStep } from './entity/cl-rollout-step.entity';
import { ClSource } from './entity/cl-source.entity';
import { ClGapTopic, ClJudgment, ClLoopAction } from './entity/cl-loop.entity';
import {
  ClUseCaseAccess,
  ClUseCaseAccessLog,
} from './entity/cl-use-case-access.entity';
import { ContextAccessService } from './service/context-access.service';
import { ContextAgentChunkService } from './service/context-agent-chunk.service';
import { ContextAgentCuratorService } from './service/context-agent-curator.service';
import { ContextBriefService } from './service/context-brief.service';
import { ContextCatalogueSubscriber } from './service/context-catalogue.subscriber';
import { ContextCatalogueSyncService } from './service/context-catalogue-sync.service';
import { ContextCitationService } from './service/context-citation.service';
import { ContextReaderKeyService } from './service/context-reader-key.service';
import { ContextRetrievalService } from './service/context-retrieval.service';
import { ContextToolsService } from './service/context-tools.service';
import { ContextChunkService } from './service/context-chunk.service';
import { ContextExtractionService } from './service/context-extraction.service';
import { ContextIndexService } from './service/context-index.service';
import { ContextLlmService } from './service/context-llm.service';
import { ContextStagingService } from './service/context-staging.service';
import { ContextUploadService } from './service/context-upload.service';
import { ContextWorkerService } from './service/context-worker.service';
import { ContextGapsService } from './service/context-gaps.service';
import { ContextKbCopyService } from './service/context-kb-copy.service';
import { ContextKbImportService } from './service/context-kb-import.service';
import { ContextLibraryRolloutService } from './service/context-library-rollout.service';
import { ContextJudgeService } from './service/context-judge.service';
import { ContextLearningService } from './service/context-learning.service';
import { ContextLoopActionsService } from './service/context-loop-actions.service';
import { ContextLoopsService } from './service/context-loops.service';
import { ContextTuningService } from './service/context-tuning.service';

/**
 * The Context Library — see docs/context-library/PLAN.md.
 *
 * One central system for the context Ally's agents retrieve: documents distilled into
 * chunks (no text kept), entries admins write, lessons agents write, and synced catalogue
 * items, in collections that each use case may only read when granted.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClCollection,
      ClUseCaseAccess,
      ClUseCaseAccessLog,
      ClSource,
      ClIngestSegment,
      ClSegmentRun,
      ClChunk,
      ClChunkSource,
      ClChunkRelation,
      ClChunkVersion,
      ClBulkUpload,
      ClRetrieval,
      ClRetrievalHit,
      ClUsageEvent,
      ClReaderKey,
      ClJudgment,
      ClLoopAction,
      ClGapTopic,
      ClRolloutStep,
    ]),
    AiModule,
    // S3, for deleting a retired Knowledge Base corpus's stored files.
    AwsModule,
    LlmAgentModule,
    PromptModule,
    RedisModule,
  ],
  controllers: [
    ContextLibraryController,
    ContextLibraryMcpController,
    // One organisation's view, for its admins (phase 6).
    ContextLibraryOrgController,
  ],
  providers: [
    ContextAccessService,
    ContextBriefService,
    ContextChunkService,
    ContextCitationService,
    ContextReaderKeyService,
    ContextRetrievalService,
    ContextToolsService,
    ContextExtractionService,
    ContextIndexService,
    ContextLlmService,
    ContextStagingService,
    ContextUploadService,
    ContextWorkerService,
    // One-off imports of retired Knowledge Base corpora (phase 4), and what follows the
    // word-for-word copies of the Ally guide's library and Debrief's guidance (phase 6).
    ContextKbImportService,
    ContextKbCopyService,
    // Drives those steps after a release, with no one at a screen.
    ContextLibraryRolloutService,
    // The learning loops (phase 3).
    ContextGapsService,
    ContextJudgeService,
    ContextLearningService,
    ContextLoopActionsService,
    ContextLoopsService,
    ContextTuningService,
    // Agent-written chunks and their curator (phase 5).
    ContextAgentChunkService,
    ContextAgentCuratorService,
    // Course Copilot's catalogue, synced from Studio (phase 7).
    ContextCatalogueSyncService,
    ContextCatalogueSubscriber,
  ],
  exports: [
    ContextAccessService,
    ContextAgentChunkService,
    ContextBriefService,
    ContextChunkService,
    ContextCitationService,
    ContextIndexService,
    ContextRetrievalService,
    ContextToolsService,
  ],
})
export class ContextLibraryModule {}
