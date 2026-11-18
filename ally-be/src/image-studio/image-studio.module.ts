import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AwsModule } from 'src/aws/aws.module';
import { ImageGenerationModule } from 'src/image-generation/image-generation.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { Track } from 'src/track/entity/track.entity';
import { ImageStudioController } from './controller/image-studio.controller';
import { GeneratedImage } from './entity/generated-image.entity';
import { GeneratedImageRepository } from './repository/generated-image.repository';
import { ImageAssetService } from './service/image-asset.service';
import { ImageComposeService } from './service/image-compose.service';
import { ImageJudgeService } from './service/image-judge.service';
import { ImagePostprocessService } from './service/image-postprocess.service';
import { ImageRenderService } from './service/image-render.service';
import { ImageStudioWorkerService } from './service/image-studio-worker.service';
import { ImageStudioService } from './service/image-studio.service';

/**
 * Image Studio: AI image generation behind every authoring image slot.
 * docs/image-studio.md.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GeneratedImage, ScenarioCharacter, Track]),
    AwsModule,
    ImageGenerationModule,
    LlmAgentModule,
    LlmUsageModule,
    PromptModule,
  ],
  controllers: [ImageStudioController],
  providers: [
    GeneratedImageRepository,
    ImageAssetService,
    ImageComposeService,
    ImageJudgeService,
    ImagePostprocessService,
    ImageRenderService,
    ImageStudioService,
    ImageStudioWorkerService,
  ],
  exports: [ImageAssetService],
})
export class ImageStudioModule {}
