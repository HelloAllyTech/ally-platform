/**
 * Print every ally-be prompt contract as JSON, `{ code: contract }`, in the
 * shape the Skills Store enforces. Used by the release check
 * (scripts/prompts/release-check.mjs) to compare live prompts with this
 * release's code before deploying.
 *
 *   npx ts-node --transpile-only scripts/prompt-contracts-json.ts > contracts.json
 */
import { PROMPT_CONTRACTS } from '../src/prompt/contracts/prompt-contracts';
import { toStoreContract } from '../src/prompt/contracts/define-prompt';

process.stdout.write(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(PROMPT_CONTRACTS).map(([code, d]) => [
        code,
        toStoreContract(d),
      ]),
    ),
    null,
    2,
  ) + '\n',
);
