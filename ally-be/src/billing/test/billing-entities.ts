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
import { BillingAccount } from '../entity/billing-account.entity';
import { CreditGrant } from '../entity/credit-grant.entity';
import { ChatbotBudget } from '../entity/chatbot-budget.entity';
import { CreditReservation } from '../entity/credit-reservation.entity';
import { EndPersonSpend } from '../entity/end-person-spend.entity';
import { EndPerson, EndPersonIdentity } from '../entity/end-person.entity';
import { CreditWarning } from '../entity/credit-warning.entity';

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
  BillingAccount,
  CreditGrant,
  ChatbotBudget,
  CreditReservation,
  EndPersonSpend,
  EndPerson,
  EndPersonIdentity,
  CreditWarning,
];
