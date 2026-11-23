import type { CreditBlockReason } from '../service/ledger.service';

/**
 * Why a builder's work is paused or refused by the credits gate, as the builder is told it. The
 * ledger has finer reasons (`CreditBlockReason`); a builder only needs to know which of these four
 * it is, because each asks something different of them:
 *
 *   out_of_credits      their balance is used up: Ally adds credits.
 *   feed_off            usage tracking is down: nothing to do, the work resumes by itself.
 *   no_payer            the chatbot has no billing account yet.
 *   ledger_unavailable  credits could not be checked just now: resumes by itself.
 *
 * Customers never see any of this: a blocked customer turn always gets the fixed crisis
 * notification (OUT_OF_CREDITS), whatever the reason.
 */
export type CreditPauseKind =
  | 'out_of_credits'
  | 'feed_off'
  | 'no_payer'
  | 'ledger_unavailable';

export function creditPauseKind(
  reason: CreditBlockReason | string | null | undefined,
): CreditPauseKind {
  switch (reason) {
    case 'feed_off':
      return 'feed_off';
    case 'no_payer':
      return 'no_payer';
    case 'ledger_unavailable':
      return 'ledger_unavailable';
    default:
      return 'out_of_credits';
  }
}

/**
 * A knowledge document's status message while its indexing waits (`kb_documents.status_message`).
 * Every one starts with "Paused:", which is how the dashboard and the resume sweep recognise them.
 */
// COPY: needs approval
export const KB_PAUSED_MESSAGES: Record<CreditPauseKind, string> = {
  out_of_credits:
    'Paused: out of credits. It will be read once you have credits again.',
  feed_off:
    'Paused: usage tracking is temporarily unavailable. It will be read automatically once it is back.',
  no_payer:
    'Paused: this chatbot has no billing account yet. It will be read once one is set up.',
  ledger_unavailable:
    'Paused: credits could not be checked just now. It will be read automatically.',
};

/** The prefix every paused status message carries. */
export const KB_PAUSED_PREFIX = 'Paused:';

/** Owner-side work refused before any AI call (`credits_required`), by reason. */
// COPY: needs approval
export const OWNER_CREDITS_MESSAGES: Record<CreditPauseKind, string> = {
  out_of_credits:
    'This needs AI credits. Contact Ally to add credits to your account.',
  feed_off:
    'Usage tracking is temporarily unavailable, so this cannot run right now. Try again in a few minutes.',
  no_payer:
    'This chatbot has no billing account yet, so this cannot run. Ally will set one up.',
  ledger_unavailable:
    'Credits could not be checked just now. Try again in a few minutes.',
};
