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
import { RoadmapNotificationService } from 'src/product-roadmap/service/roadmap-notification.service';
import { RoadmapRoleService } from './service/roadmap-role.service';
import { PlanCeilingService } from './service/plan-ceiling.service';
import { RoadmapInboxService } from './service/roadmap-inbox.service';
import { RoadmapNotification } from './entity/roadmap-notification.entity';
import { RoadmapWatch } from './entity/roadmap-watch.entity';
import { RoadmapUserPreference } from './entity/roadmap-user-preference.entity';
import { RoadmapPreferenceService } from './service/roadmap-preference.service';
import { RoadmapDigestFeedService } from './service/roadmap-digest-feed.service';
import { RoadmapItemRead } from './entity/roadmap-item-read.entity';

const ENTITIES = TypeOrmModule.forFeature([
  PlanEvent,
  PlanSpendEntry,
  PlanNotification,
  PlanCheck,
  PlanOutcomeReview,
  PlanSuggestion,
  RoadmapNotification,
  RoadmapWatch,
  RoadmapItemRead,
  RoadmapUserPreference,
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
    RoadmapRoleService,
    PlanCeilingService,
    RoadmapInboxService,
    // The roadmap's listener registry (the gateway registers on it). Provided here, a leaf both
    // Builder and the roadmap import, so there is exactly one instance.
    RoadmapNotificationService,
    RoadmapPreferenceService,
    RoadmapDigestFeedService,
  ],
  exports: [
    // Re-exported so the plan flow injects these repositories without registering them twice.
    ENTITIES,
    PlanAccessService,
    PlanEventService,
    PlanSpendService,
    PlanNotificationService,
    PlanSettingsService,
    RoadmapRoleService,
    PlanCeilingService,
    RoadmapInboxService,
    RoadmapNotificationService,
    RoadmapPreferenceService,
    RoadmapDigestFeedService,
  ],
})
export class ProductPlanningModule {}
