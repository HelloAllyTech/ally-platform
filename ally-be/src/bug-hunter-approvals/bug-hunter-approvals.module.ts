import { Module } from '@nestjs/common';
import { AuditModule } from 'src/audit/audit.module';
import { BugHunterApprovalsController } from './controller/bug-hunter-approvals.controller';
import { BugHunterApprovalsService } from './service/bug-hunter-approvals.service';
import { BugHunterBoardService } from './service/bug-hunter-board.service';
import { BughunterDbService } from './service/bughunter-db.service';

@Module({
  imports: [AuditModule],
  controllers: [BugHunterApprovalsController],
  providers: [
    BugHunterApprovalsService,
    BugHunterBoardService,
    BughunterDbService,
  ],
  // the roadmap's "file a bug" flow queues reported bugs for Bug Hunter v2 (chunk 10)
  exports: [BugHunterBoardService],
})
export class BugHunterApprovalsModule {}
