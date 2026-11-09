import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { PlanEvent } from './entity/plan-event.entity';
import { PlanSpendEntry } from './entity/plan-spend-entry.entity';
import { PlanAccessService } from './service/plan-access.service';
import { PlanEventService } from './service/plan-event.service';
import { PlanSpendService } from './service/plan-spend.service';

/**
 * The roadmap's idea-to-outcome plan (plans/roadmap-owns-planning rev 5.1).
 *
 * P0 foundations only: who may do what (PlanAccessService), the append-only
 * event log and the spend ledger. Everything is inert until a later phase calls
 * it and `builder_settings.planningEnabled` is switched on.
 *
 * DEPENDS ON NOTHING BUT ENTITIES. Builder (the interview, the specialists)
 * and the roadmap (filing) will both write spend and events here, so this
 * module must never import BuilderModule or ProductRoadmapModule — doing so
 * would close a cycle the day Builder imports this. BuilderSettings is read as
 * a bare entity for the same reason; FeatureToggleService comes from the
 * global AuthorizationModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlanEvent, PlanSpendEntry, BuilderSettings]),
  ],
  providers: [PlanAccessService, PlanEventService, PlanSpendService],
  exports: [PlanAccessService, PlanEventService, PlanSpendService],
})
export class ProductPlanningModule {}
