import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionBookmarksController } from './controller/session-bookmarks.controller';
import { SessionBookmark } from './entity/session-bookmark.entity';
import { SessionBookmarksService } from './service/session-bookmarks.service';

@Module({
  imports: [TypeOrmModule.forFeature([SessionBookmark])],
  controllers: [SessionBookmarksController],
  providers: [SessionBookmarksService],
})
export class SessionBookmarksModule {}
