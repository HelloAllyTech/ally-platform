import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from 'src/aws/aws.module';
import { OwnerUsageInterceptor } from './context/owner-usage.interceptor';
import { BillingAdminController } from './controller/billing-admin.controller';
import { BillingUsersController } from './controller/billing-users.controller';
import { BillingPlansController } from './controller/billing-plans.controller';
import { MyPlanController } from './controller/my-plan.controller';
import { PlanViewService } from './service/plan-view.service';
import { TokenBalance } from './entity/token-balance.entity';
import { TokenGrant } from './entity/token-grant.entity';
import { SpendPeriod } from './entity/spend-period.entity';
import { SpendCapService } from './service/spend-cap.service';
import { LimitsService } from './service/limits.service';
import { PlanService } from './service/plan.service';
import { Plan } from './entity/plan.entity';
import { Seat } from './entity/seat.entity';
import { SeatType } from './entity/seat-type.entity';
import { Subscription } from './entity/subscription.entity';
import { UsageCounter } from './entity/usage-counter.entity';
import { BillingAudit } from './entity/billing-audit.entity';
import { BillingModel } from './entity/billing-model.entity';
import { BillingModelPrice } from './entity/billing-model-price.entity';
import { CostAlert } from './entity/cost-alert.entity';
import { CostSettings } from './entity/cost-settings.entity';
import { FixedCost } from './entity/fixed-cost.entity';
import { UsageEvent } from './entity/usage-event.entity';
import { WhatsAppRate } from './entity/whatsapp-rate.entity';
import { BillingAuditService } from './service/billing-audit.service';
import { BillingCatalogueService } from './service/billing-catalogue.service';
import { CostAlertService } from './service/cost-alert.service';
import { CostReportService } from './service/cost-report.service';
import { UsageEventService } from './service/usage-event.service';
import { WhatsAppPricingService } from './service/whatsapp-pricing.service';
import { BillingAccount } from './entity/billing-account.entity';
import { CreditGrant } from './entity/credit-grant.entity';
import { ChatbotBudget } from './entity/chatbot-budget.entity';
import { CreditReservation } from './entity/credit-reservation.entity';
import { EndPersonSpend } from './entity/end-person-spend.entity';
import { EndPerson, EndPersonIdentity } from './entity/end-person.entity';
import { CreditWarning } from './entity/credit-warning.entity';
import { LedgerService } from './service/ledger.service';
import { EndPersonService } from './service/end-person.service';
import { CreditWarningService } from './service/credit-warning.service';
import { CreditsCutoverService } from './service/credits-cutover.service';
import { BlockedCrisisService } from './service/blocked-crisis.service';
import {
  CREDITS_STATE,
  LedgerCreditsGate,
  LedgerCreditsStateService,
} from './service/credits-state.service';
import { CREDITS_GATE } from 'src/bot-draft/working-copy/credits-gate';
import { CreditsAdminController } from './controller/credits-admin.controller';
import { MyCreditsController } from './controller/my-credits.controller';
import { CreditsStaffController } from './controller/credits-staff.controller';

/**
 * Agents v2 CR1: costs and models (Part A), plans and seats (Part C), and the spend cap that
 * replaced Part B's token allowances (their two tables remain, unread).
 *
 * Global: the engine, the SQS usage processor, the WhatsApp webhook and the setup services all
 * reach it, and importing it from each would tie those modules to each other.
 */
@Global()
@Module({
  imports: [
    AwsModule,
    TypeOrmModule.forFeature([
      BillingModel,
      BillingModelPrice,
      WhatsAppRate,
      UsageEvent,
      FixedCost,
      CostSettings,
      CostAlert,
      BillingAudit,
      TokenGrant,
      TokenBalance,
      SpendPeriod,
      Plan,
      SeatType,
      Subscription,
      Seat,
      UsageCounter,
      // Stage 6: credits.
      BillingAccount,
      CreditGrant,
      ChatbotBudget,
      CreditReservation,
      EndPersonSpend,
      EndPerson,
      EndPersonIdentity,
      CreditWarning,
    ]),
  ],
  controllers: [
    BillingAdminController,
    BillingUsersController,
    BillingPlansController,
    MyPlanController,
    CreditsAdminController,
    MyCreditsController,
    CreditsStaffController,
  ],
  providers: [
    BillingAuditService,
    BillingCatalogueService,
    UsageEventService,
    CostReportService,
    CostAlertService,
    WhatsAppPricingService,
    SpendCapService,
    PlanService,
    LimitsService,
    PlanViewService,
    LedgerService,
    EndPersonService,
    CreditWarningService,
    CreditsCutoverService,
    BlockedCrisisService,
    LedgerCreditsStateService,
    LedgerCreditsGate,
    // The stage 1b seams, bound to the ledger (stage 6).
    { provide: CREDITS_STATE, useExisting: LedgerCreditsStateService },
    { provide: CREDITS_GATE, useExisting: LedgerCreditsGate },
    { provide: APP_INTERCEPTOR, useClass: OwnerUsageInterceptor },
  ],
  exports: [
    BillingAuditService,
    BillingCatalogueService,
    UsageEventService,
    CostReportService,
    CostAlertService,
    WhatsAppPricingService,
    SpendCapService,
    PlanService,
    LimitsService,
    PlanViewService,
    LedgerService,
    EndPersonService,
    BlockedCrisisService,
    LedgerCreditsStateService,
    CREDITS_STATE,
    CREDITS_GATE,
  ],
})
export class BillingModule {}
