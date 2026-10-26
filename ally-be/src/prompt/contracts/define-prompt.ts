import { PromptContract } from '../entity/prompt.entity';
// Relative, type-only or dependency-free imports only: the release check runs
// this file under plain ts-node (scripts/prompt-contracts-json.ts), which does
// not resolve the `src/` path alias.
import type { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { renderTemplate } from '../../learn/util/autofill-shared.util';

/**
 * Typed prompt contracts: what a prompt's code supplies to its template, and
 * how the prompt shows up in the Skills Store.
 *
 * Each ally-be prompt is declared once in `prompt-contracts.ts` with the
 * variables its call site passes, each `'required'` (the template must use
 * it, the code always supplies it) or `'optional'`. From that one declaration:
 *
 * - `renderPrompt` type-checks a call site's inputs (`PromptInputs<typeof X>`),
 *   so a renamed or missing variable is a compile error, not a blank in prod;
 * - sync sends the contract and the display details to the Skills Store, which
 *   refuses a version that drops a required variable (or, for a closed
 *   contract, uses an unknown one);
 * - a jest test checks every Git default still satisfies its contract.
 *
 * The same idea as a template engine's declared inputs (LangChain's
 * `input_variables`, DSPy signatures, BAML function parameters), in this
 * repo's idiom. Recipe: docs/prompts-folder.md, "Adding a new prompt".
 */
export type VariableRule = 'required' | 'optional';

/**
 * How the prompt shows up in the Skills Store. All optional: without them the
 * name, description and category come from the file's path. Sync writes the
 * description, category and runtimes on every deploy; the name only when the
 * prompt is created (a rename in the Skills Store is an admin's to make).
 */
export interface PromptDetails {
  name?: string;
  description?: string;
  category?: string;
  /**
   * Which runtimes read this prompt. Omit unless you know: an omitted value
   * keeps the model picker's conservative default, and a wrong one offers a
   * model the consuming runtime cannot execute.
   */
  runtimes?: `${LlmRuntime}`[];
  /**
   * The model a NEW prompt starts on. Applied only when sync creates the row:
   * after that the model belongs to the prompt's versions in the Skills
   * Store, and a redeploy must never undo it.
   */
  defaultModel?: { provider: string; model: string };
}

export interface PromptDefinition<
  S extends Record<string, VariableRule> = Record<string, VariableRule>,
> {
  code: string;
  variables: S;
  /**
   * Open (the default): the template may also use variables not declared here
   * — the store only enforces `required`. Close a contract once its variable
   * list is complete, and the store refuses unknown ones too.
   */
  open: boolean;
  /** Bump on a breaking change; the release check compares live text against it. */
  contractVersion: number;
  /**
   * How the code reads the answer. `'json'`: it parses free text as JSON, so
   * the text must ask for JSON; CI renders the default and checks one cheap
   * model call returns parseable JSON. `'structured'`: the provider enforces
   * JSON or a schema (jsonMode, response_format), so no model check is needed.
   */
  output?: 'json' | 'structured';
  details: PromptDetails;
}

/** A template value: anything the call site stringifies into the text. */
export type PromptValue = string | number | boolean | null | undefined;

/** The input type a call site passes for a prompt. */
export type PromptInputs<D extends PromptDefinition> =
  D extends PromptDefinition<infer S>
    ? {
        [K in keyof S as S[K] extends 'required' ? K : never]: PromptValue;
      } & {
        [K in keyof S as S[K] extends 'optional' ? K : never]?: PromptValue;
      }
    : never;

export function definePrompt<const S extends Record<string, VariableRule>>(
  code: string,
  variables: S,
  options: PromptDetails & {
    open?: boolean;
    contractVersion?: number;
    output?: 'json' | 'structured';
  } = {},
): PromptDefinition<S> {
  const { open, contractVersion, output, ...details } = options;
  return {
    code,
    variables,
    open: open ?? true,
    contractVersion: contractVersion ?? 1,
    ...(output ? { output } : {}),
    details,
  };
}

function isPromptDefinition(value: unknown): value is PromptDefinition {
  const v = value as Partial<PromptDefinition> | null;
  return (
    typeof v?.code === 'string' &&
    typeof v.variables === 'object' &&
    typeof v.details === 'object'
  );
}

/**
 * Every definition exported from a module, keyed by code. A code declared
 * twice would silently drop one contract, so it throws.
 */
export function collectContracts(
  exported: Record<string, unknown>,
): Readonly<Record<string, PromptDefinition>> {
  const byCode: Record<string, PromptDefinition> = {};
  for (const value of Object.values(exported)) {
    if (!isPromptDefinition(value)) continue;
    if (byCode[value.code]) {
      throw new Error(`Prompt contract "${value.code}" is declared twice.`);
    }
    byCode[value.code] = value;
  }
  return byCode;
}

/** The contract as the Skills Store stores and enforces it. */
export function toStoreContract(definition: PromptDefinition): PromptContract {
  const names = Object.keys(definition.variables).sort();
  return {
    variables: definition.open ? null : names,
    required: names.filter((n) => definition.variables[n] === 'required'),
    contractVersion: definition.contractVersion,
    ...(definition.output ? { output: definition.output } : {}),
  };
}

/** Required variables the call site did not supply: empty when it is complete. */
export function missingInputs(
  definition: PromptDefinition,
  inputs: Record<string, unknown>,
): string[] {
  return Object.entries(definition.variables)
    .filter(([name, rule]) => rule === 'required' && inputs[name] == null)
    .map(([name]) => name);
}

/**
 * Fill a prompt's `{{name}}` placeholders, with the inputs type-checked
 * against its contract: a missing required variable or a misspelt one is a
 * compile error. `null`/`undefined` render as empty.
 *
 *   const text = await this.promptSharedService.getPromptByCode(FEEDBACK_X.code);
 *   const system = renderPrompt(FEEDBACK_X, text, { transcript, tone });
 */
export function renderPrompt<D extends PromptDefinition>(
  _definition: D,
  template: string,
  inputs: PromptInputs<D>,
): string {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    inputs as Record<string, PromptValue>,
  )) {
    if (value != null) values[name] = String(value);
  }
  return renderTemplate(template, values);
}
