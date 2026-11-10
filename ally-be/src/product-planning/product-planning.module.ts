import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { PlanEvent } from './entity/plan-event.entity';
import { PlanSpendEntry } from './entity/plan-spend-entry.entity';
import { PlanNotification } from './entity/plan-notification.entity';
import { PlanCheck } from './entity/plan-check.entity';
import { PlanOutcomeReview } from './entity/plan-outcome-review.entity';
import { PlanSuggestion } from './entity/plan-suggestion.entity';
import { PlanAccessService } from './service/plan-access.service';
import { PlanEventService } from './service/plan-event.service';
import { PlanSpendService } from './service/plan-spend.service';
import { PlanNotificationService } from './service/plan-notification.service';
import { PlanSettingsService } from './service/plan-settings.service';

const ENTITIES = TypeOrmModule.forFeature([
  PlanEvent,
  PlanSpendEntry,
  PlanNotification,
  PlanCheck,
  PlanOutcomeReview,
  PlanSuggestion,
  BuilderSettings,
]);

/**
 * The roadmap's idea-to-outcome plan (plans/roadmap-owns-planning rev 5.2):
 * the building blocks every phase shares — who may do what (PlanAccessService),
 * the append-only event log, the spend ledger, plan notifications, the
 * planning settings, and the check and outcome-review tables.
 *
 * DEPENDS ON NOTHING BUT ENTITIES. Builder and the roadmap both write here, so
 * this module must never import BuilderModule or ProductRoadmapModule — that
 * would close a cycle. The plan FLOW (filing, leads, checks, outcomes) lives in
 * `product-roadmap/plan/`, inside ProductRoadmapModule, which may depend on
 * Builder. BuilderSettings is read as a bare entity for the same reason;
 * FeatureToggleService comes from the global AuthorizationModule.
 */
@Module({
  imports: [ENTITIES],
  providers: [
    PlanAccessService,
    PlanEventService,
    PlanSpendService,
    PlanNotificationService,
    PlanSettingsService,
  ],
  exports: [
    // Re-exported so the plan flow injects these repositories without registering them twice.
    ENTITIES,
    PlanAccessService,
    PlanEventService,
    PlanSpendService,
    PlanNotificationService,
    PlanSettingsService,
  ],
})
export class ProductPlanningModule {}
