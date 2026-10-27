import { PromptDefinition, renderPrompt } from 'src/prompt/contracts';
import {
  loadPromptTemplate,
  shippedPromptDefault,
} from 'src/common/util/prompt-template.util';

/** A default may use a declared variable as `{{name}}`, or `<name>` (rendered only when passed). */
const usesVariable = (text: string, name: string) =>
  new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}|<${name}>`).test(text);

/**
 * Checks a prompt's shipped default is a working base (see
 * docs/adding-a-prompt.md): it uses every variable its contract declares,
 * keeps the literals the code parses (`markers`), and rendered the way a call
 * site does with no store reachable it is non-empty with every variable
 * filled. The live text is the Skills Store's; this is what a fresh clone runs.
 */
export async function expectWorkingBase(
  definition: PromptDefinition,
  markers: string[],
): Promise<void> {
  const shipped = shippedPromptDefault(definition.code);
  expect(shipped).toBeTruthy();
  const names = Object.keys(definition.variables);
  expect(names.filter((name) => !usesVariable(shipped!, name))).toEqual([]);
  expect(markers.filter((marker) => !shipped!.includes(marker))).toEqual([]);

  const inputs = Object.fromEntries(names.map((name) => [name, `«${name}»`]));
  const loaded = await loadPromptTemplate(null, definition.code);
  const rendered = renderPrompt(definition, loaded, inputs);
  expect(rendered.trim()).not.toBe('');
  expect(rendered).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  for (const name of names) {
    expect(rendered).toContain(`«${name}»`);
    expect(rendered).not.toContain(`<${name}>`);
  }
}
