import { BillingAudit } from '../entity/billing-audit.entity';
import { BillingModel } from '../entity/billing-model.entity';
import { BillingModelPrice } from '../entity/billing-model-price.entity';
import { CostAlert } from '../entity/cost-alert.entity';
import { CostSettings } from '../entity/cost-settings.entity';
import { FixedCost } from '../entity/fixed-cost.entity';
import { TokenBalance } from '../entity/token-balance.entity';
import { TokenGrant } from '../entity/token-grant.entity';
import { UsageEvent } from '../entity/usage-event.entity';
import { WhatsAppRate } from '../entity/whatsapp-rate.entity';
import { Plan } from '../entity/plan.entity';
import { SpendPeriod } from '../entity/spend-period.entity';
import { Seat } from '../entity/seat.entity';
import { SeatType } from '../entity/seat-type.entity';
import { Subscription } from '../entity/subscription.entity';
import { UsageCounter } from '../entity/usage-counter.entity';

/** Every CR1 entity, for the Postgres specs' data source. */
export const BILLING_ENTITIES = [
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
];
