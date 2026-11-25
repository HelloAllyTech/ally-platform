import { PurposeId, SafetyPackId } from '../../bot-draft/enum/bot-draft.enum';
import { HEALTH_PACKS } from '../lists/ready-made-lists';
import { listDefinition } from './template-lists';
import { planInstall, type SetupAnswers } from './template-plan';
import type { SetupFill, UseCaseTemplate } from './templates';

/**
 * What a template must satisfy before staff can publish it (Assistants admin → Templates).
 *
 * These are the same rules the built-in templates are held to in `test/templates.spec.ts`, as a
 * function over data: a manifest is `unknown` here, so a hand-edited or half-finished draft gets
 * a list of problems, never an exception. Pure, so the editor can call it on every save and the
 * registry can refuse a stored manifest that no longer passes.
 *
 * `error` blocks publishing; `warning` is shown but doesn't.
 */

export interface TemplateIssue {
  severity: 'error' | 'warning';
  /** Where it is: `name`, `lists.2.line`, `setup.0.fills.1`, `checkups.3.send`… */
  path: string;
  message: string;
}

export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export const TEMPLATE_LIMITS = {
  name: [2, 60],
  one_liner: [5, 140],
  for: [5, 200],
  instructions: [20, 2000],
  line: [21, 300],
  /** Zero is fine: the staff-handbook template answers from documents alone. */
  lists: [0, 12],
  setup: [2, 4],
  checkups: [5, 8],
  ask: [3, 200],
  send: [3, 300],
} as const;

/** Wording that would talk the assistant round the customer's "yes" (H1). */
export const AROUND_THE_YES =
  /without (asking|checking|confirm)|no need to (ask|check|confirm)|straight ?away|right away|immediately (book|save|cancel)|skip (the )?confirm|don.t (ask|wait) (for|to) (a |the )?(yes|confirm)|assume (they|the person) (agree|said yes)/i;

const GROUPS = ['organisations', 'businesses'];
const ABILITIES = ['do_it', 'never'];
const KINDS = ['text', 'long_text', 'yes_no', 'choices'];
const EXPECTS = ['answer', 'decline', 'clarify', 'crisis_only'];
const FILLS = [
  'fact',
  'helpline',
  'entries',
  'field',
  'options',
  'pack',
  'languages',
  'channel',
  'list',
];

const ZONE = 'Asia/Kolkata';
const NOW = new Date('2026-11-20T06:00:00Z');

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateTemplate(manifest: unknown): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const err = (path: string, message: string) =>
    issues.push({ severity: 'error', path, message });
  const warn = (path: string, message: string) =>
    issues.push({ severity: 'warning', path, message });

  if (!isObject(manifest)) {
    err('', 'The template is empty.');
    return issues;
  }
  const t = manifest;

  const text = (
    path: string,
    value: unknown,
    [min, max]: readonly [number, number],
    label: string,
  ): string | null => {
    if (typeof value !== 'string' || value.trim().length < min) {
      err(path, `${label} needs at least ${min} characters.`);
      return null;
    }
    if (value.length > max) {
      err(path, `${label} can be at most ${max} characters.`);
      return null;
    }
    return value;
  };

  // ---- the card --------------------------------------------------------------------------------
  if (typeof t.id !== 'string' || !TEMPLATE_KEY_PATTERN.test(t.id)) {
    err(
      'id',
      'The key is lowercase letters, numbers and underscores, starting with a letter (2–40 characters).',
    );
  }
  if (!GROUPS.includes(t.group as string)) {
    err('group', 'Choose “For organisations” or “For businesses”.');
  }
  text('name', t.name, TEMPLATE_LIMITS.name, 'The name');
  text('one_liner', t.one_liner, TEMPLATE_LIMITS.one_liner, 'The one-liner');
  text('for', t.for, TEMPLATE_LIMITS.for, '“Who it’s for”');
  if (typeof t.icon !== 'string' || !t.icon.trim() || t.icon.length > 40) {
    err('icon', 'Pick an icon (an emoji, up to 40 characters).');
  }
  if (!Object.values(PurposeId).includes(t.purpose as PurposeId)) {
    err('purpose', 'Choose what the assistant is for.');
  }
  if (
    t.pack !== null &&
    !Object.values(SafetyPackId).includes(t.pack as SafetyPackId)
  ) {
    err('pack', 'Choose a safety pack, or none.');
  }
  for (const flag of ['hand_over', 'memory'] as const) {
    if (typeof t[flag] !== 'boolean') err(flag, 'This must be on or off.');
  }
  const instructions = text(
    'instructions',
    t.instructions,
    TEMPLATE_LIMITS.instructions,
    'The instructions',
  );
  if (instructions !== null) {
    if (!instructions.includes('{name}')) {
      err(
        'instructions',
        'The instructions must include {name}, where the organisation’s name goes.',
      );
    }
    if (AROUND_THE_YES.test(instructions)) {
      err(
        'instructions',
        'The instructions talk round the person’s “yes”. Every add, change or cancel needs their yes.',
      );
    }
  }
  if (
    t.memory_notice !== undefined &&
    (typeof t.memory_notice !== 'string' || t.memory_notice.length > 300)
  ) {
    err('memory_notice', 'The memory notice can be at most 300 characters.');
  }
  if (!Array.isArray(t.suggested_for)) {
    err(
      'suggested_for',
      'This must be a list of industries (it can be empty).',
    );
  }

  // ---- lists -----------------------------------------------------------------------------------
  const lists = Array.isArray(t.lists) ? t.lists : null;
  const setup = Array.isArray(t.setup) ? t.setup : null;
  const checkups = Array.isArray(t.checkups) ? t.checkups : null;
  const [minLists, maxLists] = TEMPLATE_LIMITS.lists;
  if (!lists || lists.length < minLists || lists.length > maxLists) {
    err('lists', `Use up to ${maxLists} lists.`);
  }
  const listKeys: string[] = [];
  (lists ?? []).forEach((raw, i) => {
    const at = `lists.${i}`;
    if (!isObject(raw)) return err(at, 'This list is not filled in.');
    const key = typeof raw.key === 'string' ? raw.key : '';
    const def = listDefinition(key);
    if (!def) return err(`${at}.key`, `There is no list called “${key}”.`);
    if (listKeys.includes(key)) err(`${at}.key`, 'This list is used twice.');
    listKeys.push(key);

    for (const a of ['find', 'create', 'update'] as const) {
      if (!ABILITIES.includes(raw[a] as string)) {
        err(`${at}.${a}`, 'Choose “Do it” or “Never”.');
      }
    }
    const writable = def.fields.some((f) => f.agent_write);
    if ((raw.create === 'do_it' || raw.update === 'do_it') && !writable) {
      err(
        at,
        `The assistant has nothing it can fill in on “${def.name}”, so it can’t add or change entries there.`,
      );
    }
    const line = text(
      `${at}.line`,
      raw.line,
      TEMPLATE_LIMITS.line,
      'The line for this list',
    );
    if (line !== null && AROUND_THE_YES.test(line)) {
      err(
        `${at}.line`,
        'This line talks round the person’s “yes”. Every add, change or cancel needs their yes.',
      );
    }
    if (raw.only_if !== undefined) {
      const q = (setup ?? []).find((s) => isObject(s) && s.key === raw.only_if);
      if (!isObject(q) || q.kind !== 'yes_no') {
        err(
          `${at}.only_if`,
          'A list that’s only sometimes added must depend on a yes/no setup question.',
        );
      }
    }
    if (raw.examples !== undefined) {
      const fieldKeys = def.fields.map((f) => f.key);
      if (!Array.isArray(raw.examples)) {
        err(`${at}.examples`, 'Examples must be a list of entries.');
      } else {
        raw.examples.forEach((row, r) => {
          for (const k of isObject(row) ? Object.keys(row) : []) {
            if (!fieldKeys.includes(k)) {
              err(
                `${at}.examples.${r}`,
                `“${k}” isn’t a detail of “${def.name}”.`,
              );
            }
          }
        });
      }
    }
    // A list pointing at another one needs that one installed first.
    for (const f of def.fields) {
      const to = f.options?.to as string | undefined;
      if (f.type === 'relation' && to && to !== 'contact') {
        const at2 = (lists ?? []).findIndex((l) => isObject(l) && l.key === to);
        if (at2 < 0 || at2 >= i) {
          err(
            at,
            `“${def.name}” points at “${listDefinition(to)?.name ?? to}”, which must be added first.`,
          );
        }
      }
    }
    // Health packs: nothing the person says about symptoms may be written back by the assistant.
    if (t.pack && HEALTH_PACKS.has(t.pack as SafetyPackId)) {
      for (const f of def.fields) {
        if (f.privacy?.never_store && f.agent_write) {
          err(
            at,
            `With a health safety pack, the assistant may not write “${f.label}” on “${def.name}”.`,
          );
        }
      }
    }
  });

  // ---- setup questions -------------------------------------------------------------------------
  const [minSetup, maxSetup] = TEMPLATE_LIMITS.setup;
  if (!setup || setup.length < minSetup || setup.length > maxSetup) {
    err('setup', `Ask ${minSetup} to ${maxSetup} setup questions.`);
  }
  const setupKeys: string[] = [];
  (setup ?? []).forEach((raw, i) => {
    const at = `setup.${i}`;
    if (!isObject(raw)) return err(at, 'This question is not filled in.');
    const key = typeof raw.key === 'string' ? raw.key : '';
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(key)) {
      err(
        `${at}.key`,
        'The question’s key is lowercase letters, numbers and underscores.',
      );
    } else if (setupKeys.includes(key)) {
      err(`${at}.key`, 'Two questions share this key.');
    }
    setupKeys.push(key);
    text(`${at}.ask`, raw.ask, TEMPLATE_LIMITS.ask, 'The question');
    if (!KINDS.includes(raw.kind as string)) {
      err(`${at}.kind`, 'Choose how the owner answers.');
    }
    if (
      raw.kind === 'choices' &&
      (!Array.isArray(raw.choices) || raw.choices.length === 0)
    ) {
      err(`${at}.choices`, 'Give the choices.');
    }
    if (!Array.isArray(raw.fills)) {
      return err(`${at}.fills`, 'Say where the answer goes.');
    }
    raw.fills.forEach((fill, f) =>
      checkFill(
        `${at}.fills.${f}`,
        fill,
        raw,
        t as unknown as UseCaseTemplate,
        listKeys,
        err,
      ),
    );
  });

  // ---- checkups --------------------------------------------------------------------------------
  const [minChecks, maxChecks] = TEMPLATE_LIMITS.checkups;
  if (!checkups || checkups.length < minChecks || checkups.length > maxChecks) {
    err(
      'checkups',
      `Write ${minChecks} to ${maxChecks} starter checkup questions.`,
    );
  }
  const checkIds: string[] = [];
  (checkups ?? []).forEach((raw, i) => {
    const at = `checkups.${i}`;
    if (!isObject(raw)) return err(at, 'This question is not filled in.');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(id)) {
      err(`${at}.id`, 'The id is lowercase letters, numbers and underscores.');
    } else if (checkIds.includes(id)) {
      err(`${at}.id`, 'Two checkup questions share this id.');
    }
    checkIds.push(id);
    text(`${at}.send`, raw.send, TEMPLATE_LIMITS.send, 'The question');
    if (!EXPECTS.includes(raw.expect as string)) {
      err(`${at}.expect`, 'Choose what a good reply does.');
    }
    if (
      !Array.isArray(raw.facts) ||
      raw.facts.length === 0 ||
      raw.facts.some((x) => typeof x !== 'string' || !x.trim())
    ) {
      err(`${at}.facts`, 'Say what a good reply must include.');
    }
    if (raw.needs !== undefined && !listKeys.includes(raw.needs as string)) {
      err(`${at}.needs`, 'This depends on a list the template doesn’t add.');
    }
  });

  // ---- the install itself ----------------------------------------------------------------------
  // Skipped questions and fully answered ones must both plan without a leftover `{…}` or `||`.
  if (!issues.some((i) => i.severity === 'error')) {
    const tpl = t as unknown as UseCaseTemplate;
    for (const [label, answers] of [
      ['with every question skipped', {}],
      ['with every question answered', sampleAnswers(tpl)],
    ] as const) {
      try {
        const plan = planInstall(tpl, answers, { zone: ZONE, now: NOW });
        for (const c of plan.cases) {
          const bad = [c.question, ...c.facts].find((s) => /[{}]|\|\|/.test(s));
          if (bad !== undefined) {
            err(
              'checkups',
              `A checkup question still has an unfilled {placeholder} ${label}: “${bad.slice(0, 60)}”.`,
            );
            break;
          }
        }
        if (tpl.pack && plan.pack !== tpl.pack) {
          err('pack', `The safety pack is lost ${label}.`);
        }
        if (plan.cases.length < Math.min(5, checkups?.length ?? 0) - 2) {
          warn(
            'checkups',
            `Only ${plan.cases.length} checkup questions are left ${label}; they depend on lists or answers.`,
          );
        }
      } catch (e) {
        err('', `Installing ${label} fails: ${(e as Error).message}`);
      }
    }
  }
  return issues;
}

function checkFill(
  at: string,
  fill: unknown,
  question: Record<string, unknown>,
  t: UseCaseTemplate,
  listKeys: string[],
  err: (path: string, message: string) => void,
) {
  if (!isObject(fill) || !FILLS.includes(fill.to as string)) {
    return err(at, 'Choose where the answer goes.');
  }
  const f = fill as unknown as SetupFill & Record<string, unknown>;
  if ('list' in f && f.to !== 'list') {
    const list = String(f.list);
    if (!listKeys.includes(list)) {
      return err(at, `“${list}” isn’t one of this template’s lists.`);
    }
    const def = listDefinition(list)!;
    const fieldKeys = def.fields.map((x) => x.key);
    if (f.to === 'entries') {
      const cols = Array.isArray(f.columns) ? (f.columns as string[]) : [];
      if (!cols.length) err(at, 'Say which details each line fills in.');
      for (const c of cols) {
        if (!fieldKeys.includes(c)) {
          err(at, `“${c}” isn’t a detail of “${def.name}”.`);
        }
      }
    }
    if (f.to === 'field' || f.to === 'options') {
      if (!fieldKeys.includes(String(f.field))) {
        err(at, `“${String(f.field)}” isn’t a detail of “${def.name}”.`);
      } else if (f.to === 'options') {
        const field = def.fields.find((x) => x.key === f.field)!;
        if (!field.example_options) {
          err(at, `“${field.label}” has no choices to fill in.`);
        }
      }
    }
  }
  if (f.to === 'list' && !t.lists.some((l) => l.only_if === question.key)) {
    err(at, 'No list in this template waits for a yes to this question.');
  }
  if (
    f.to === 'pack' &&
    !Object.values(SafetyPackId).includes(f.pack as SafetyPackId)
  ) {
    err(at, 'Choose a safety pack.');
  }
}

/** A full set of answers for a template: each question answered in the shape it asks for. */
export function sampleAnswers(t: UseCaseTemplate): SetupAnswers {
  const out: SetupAnswers = {};
  for (const q of t.setup) {
    if (q.kind === 'yes_no') out[q.key] = true;
    else if (q.kind === 'choices') out[q.key] = [q.choices![0]];
    else out[q.key] = 'First thing - 1200\nSecond thing - 2500';
  }
  return out;
}
