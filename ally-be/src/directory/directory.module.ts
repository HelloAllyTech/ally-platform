import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DirectoryPublicController } from './controller/directory-public.controller';
import { DirectoryController } from './controller/directory.controller';
import { DirectoryCollectionEntry } from './entity/directory-collection-entry.entity';
import { DirectoryCollection } from './entity/directory-collection.entity';
import { DirectoryEntry } from './entity/directory-entry.entity';
import { DirectoryPublicService } from './service/directory-public.service';
import { DirectoryService } from './service/directory.service';

/** The mental health resources directory (admin app, /directory). Concepts card: "Directory". */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DirectoryEntry,
      DirectoryCollection,
      DirectoryCollectionEntry,
    ]),
  ],
  controllers: [DirectoryController, DirectoryPublicController],
  providers: [DirectoryService, DirectoryPublicService],
})
export class DirectoryModule {}
