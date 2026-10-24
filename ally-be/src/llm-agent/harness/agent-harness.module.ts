import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from 'src/aws/aws.module';
import { AgentConfigOverrideAudit } from '../entity/agent-config-override-audit.entity';
import { AgentConfigOverride } from '../entity/agent-config-override.entity';
import { AgentCostLedger } from '../entity/agent-cost-ledger.entity';
import { AgentReleaseAudit } from '../entity/agent-release-audit.entity';
import { AgentRelease } from '../entity/agent-release.entity';
import { AgentTurnTrace } from '../entity/agent-turn-trace.entity';
import { AgentTurn } from '../entity/agent-turn.entity';
import { AgentConfigOverrideService } from './config/agent-config-override.service';
import { AgentCostLedgerService } from './budget/agent-cost-ledger.service';
import { AgentReleaseService } from './release/agent-release.service';
import { AgentTraceService } from './trace/agent-trace.service';
import { AgentTurnStoreService } from './turn/agent-turn-store.service';

/**
 * The reusable agent harness (plans/ally-guide/plan.md §7): releases, the
 * turn state machine, product traces and the cost ledger. Generic across agents; the Ally
 * guide is its first consumer. The stage runner (`runHarnessStages`) is a
 * plain function and needs no provider.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentRelease,
      AgentReleaseAudit,
      AgentConfigOverride,
      AgentConfigOverrideAudit,
      AgentTurn,
      AgentTurnTrace,
      AgentCostLedger,
    ]),
    AwsModule,
  ],
  providers: [
    AgentConfigOverrideService,
    AgentReleaseService,
    AgentTurnStoreService,
    AgentTraceService,
    AgentCostLedgerService,
  ],
  exports: [
    AgentConfigOverrideService,
    AgentReleaseService,
    AgentTurnStoreService,
    AgentTraceService,
    AgentCostLedgerService,
  ],
})
export class AgentHarnessModule {}
