import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Whether a builder has credits for AI work. The global BillingModule binds `CREDITS_GATE` to the
 * ledger (`LedgerCreditsGate` in `billing/service/credits-state.service.ts`, the builder's free
 * balance, R2). Every injection here is optional; without a binding everything is available, which
 * is the stage 1 `creditsAvailable` stub's answer (`AlwaysCreditsGate`, for specs).
 */
export interface CreditsGate {
  /** True when the builder (the account that pays) may start AI work from their free balance. */
  creditsAvailable(builderUserId: number | null | undefined): Promise<boolean>;
}

export const CREDITS_GATE = 'BOT_DRAFT_CREDITS_GATE';

@Injectable()
export class AlwaysCreditsGate implements CreditsGate {
  async creditsAvailable(): Promise<boolean> {
    return true;
  }
}

/** The plain refusal at $0: anything needing AI is disabled with a prompt to contact Ally. */
export const CREDITS_REQUIRED = 'credits_required';

// COPY: needs approval
export const CREDITS_REQUIRED_MESSAGE =
  'This needs AI credits. Contact Ally to add credits to your account.';

export function creditsRequired(details?: Record<string, unknown>) {
  return new HttpException(
    {
      errorCode: CREDITS_REQUIRED,
      message: CREDITS_REQUIRED_MESSAGE,
      ...(details ? { details } : {}),
    },
    HttpStatus.PAYMENT_REQUIRED,
  );
}
