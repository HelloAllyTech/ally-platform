import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AwsModule } from 'src/aws/aws.module';
import { AuthorizationModule } from 'src/authorization/authorization.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { RedisModule } from 'src/redis/redis.module';

import { BlogAuthoringController } from './controller/blog-authoring.controller';
import { BlogReviewController } from './controller/blog-review.controller';
import { BlogController } from './controller/blog.controller';
import { BlogAuthorKey } from './entity/blog-author-key.entity';
import {
  BlogReviewLink,
  BlogReviewSuggestion,
} from './entity/blog-review.entity';
import { Blog } from './entity/blog.entity';
import { BlogRepository } from './repository/blog.repository';
import { BlogAuthorKeyService } from './service/blog-author-key.service';
import { BlogAuthoringToolsService } from './service/blog-authoring-tools.service';
import { BlogReviewService } from './service/blog-review.service';
import { BlogService } from './service/blog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Blog,
      BlogAuthorKey,
      BlogReviewLink,
      BlogReviewSuggestion,
    ]),
    AwsModule,
    AuthorizationModule,
    RedisModule,
    PromptModule,
  ],
  controllers: [BlogController, BlogAuthoringController, BlogReviewController],
  providers: [
    BlogRepository,
    BlogService,
    BlogAuthorKeyService,
    BlogAuthoringToolsService,
    BlogReviewService,
  ],
  exports: [BlogService],
})
export class BlogModule {}
