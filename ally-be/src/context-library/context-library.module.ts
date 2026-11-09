import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from 'src/ai/ai.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { RedisModule } from 'src/redis/redis.module';
import { ContextLibraryMcpController } from './controller/context-library-mcp.controller';
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
import { ClSource } from './entity/cl-source.entity';
import {
  ClUseCaseAccess,
  ClUseCaseAccessLog,
} from './entity/cl-use-case-access.entity';
import { ContextAccessService } from './service/context-access.service';
import { ContextBriefService } from './service/context-brief.service';
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
    ]),
    AiModule,
    LlmAgentModule,
    PromptModule,
    RedisModule,
  ],
  controllers: [ContextLibraryController, ContextLibraryMcpController],
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
  ],
  exports: [
    ContextAccessService,
    ContextBriefService,
    ContextChunkService,
    ContextCitationService,
    ContextIndexService,
    ContextRetrievalService,
    ContextToolsService,
  ],
})
export class ContextLibraryModule {}
