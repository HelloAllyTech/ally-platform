import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsModule } from 'src/aws/aws.module';
import { OwnerUsageInterceptor } from './context/owner-usage.interceptor';
import { BillingAdminController } from './controller/billing-admin.controller';
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

/**
 * Agents v2 CR1: costs and models (Part A), tokens (Part B), plans and seats (Part C).
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
    ]),
  ],
  controllers: [BillingAdminController],
  providers: [
    BillingAuditService,
    BillingCatalogueService,
    UsageEventService,
    CostReportService,
    CostAlertService,
    WhatsAppPricingService,
    { provide: APP_INTERCEPTOR, useClass: OwnerUsageInterceptor },
  ],
  exports: [
    BillingAuditService,
    BillingCatalogueService,
    UsageEventService,
    CostReportService,
    CostAlertService,
    WhatsAppPricingService,
  ],
})
export class BillingModule {}
