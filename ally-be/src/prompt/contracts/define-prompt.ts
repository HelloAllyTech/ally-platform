import { PromptContract } from '../entity/prompt.entity';

/**
 * Typed prompt contracts: what a prompt's code supplies to its template.
 *
 * Each ally-be prompt is declared once in `prompt-contracts.ts` with the
 * variables its call site passes, each `'required'` (the template must use
 * it, the code always supplies it) or `'optional'`. From that one declaration:
 *
 * - TypeScript gives the call site its input type (`PromptInputs<typeof X>`),
 *   so a renamed or missing variable is a compile error, not a blank in prod;
 * - sync sends the contract to the Skills Store, which refuses a version that
 *   drops a required variable (or, for a closed contract, uses an unknown one);
 * - a jest test checks every Git default still satisfies its contract.
 *
 * The same idea as a template engine's declared inputs (LangChain's
 * `input_variables`, DSPy signatures, BAML function parameters), in this
 * repo's idiom.
 */
export type VariableRule = 'required' | 'optional';

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
   * `'json'` when the code parses the model's answer as JSON. CI then renders
   * the default and checks one cheap model call returns parseable JSON.
   */
  output?: 'json';
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
  options: { open?: boolean; contractVersion?: number; output?: 'json' } = {},
): PromptDefinition<S> {
  return {
    code,
    variables,
    open: options.open ?? true,
    contractVersion: options.contractVersion ?? 1,
    ...(options.output ? { output: options.output } : {}),
  };
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
