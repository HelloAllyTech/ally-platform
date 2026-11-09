import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from 'src/ai/ai.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { RedisModule } from 'src/redis/redis.module';
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
  ClIngestSegment,
  ClSegmentRun,
} from './entity/cl-ingest-segment.entity';
import { ClSource } from './entity/cl-source.entity';
import {
  ClUseCaseAccess,
  ClUseCaseAccessLog,
} from './entity/cl-use-case-access.entity';
import { ContextAccessService } from './service/context-access.service';
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
    ]),
    AiModule,
    LlmAgentModule,
    PromptModule,
    RedisModule,
  ],
  controllers: [ContextLibraryController],
  providers: [
    ContextAccessService,
    ContextChunkService,
    ContextExtractionService,
    ContextIndexService,
    ContextLlmService,
    ContextStagingService,
    ContextUploadService,
    ContextWorkerService,
  ],
  exports: [ContextAccessService, ContextChunkService, ContextIndexService],
})
export class ContextLibraryModule {}
