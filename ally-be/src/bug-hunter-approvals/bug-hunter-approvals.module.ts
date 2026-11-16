import { Module } from '@nestjs/common';
import { AuditModule } from 'src/audit/audit.module';
import { BugHunterApprovalsController } from './controller/bug-hunter-approvals.controller';
import { BugHunterApprovalsService } from './service/bug-hunter-approvals.service';
import { BughunterDbService } from './service/bughunter-db.service';

@Module({
  imports: [AuditModule],
  controllers: [BugHunterApprovalsController],
  providers: [BugHunterApprovalsService, BughunterDbService],
})
export class BugHunterApprovalsModule {}
