import * as declared from './prompt-contracts';
import { collectContracts } from './define-prompt';

export * from './define-prompt';
export * from './prompt-contracts';

/** Every ally-be prompt contract, keyed by code: each export of prompt-contracts.ts. */
export const PROMPT_CONTRACTS = collectContracts(declared);
