import { TEMPLATES, type UseCaseTemplate } from '../templates';
import { validateTemplate } from '../template-validation';

const clone = (t: UseCaseTemplate): UseCaseTemplate => structuredClone(t);
const errors = (m: unknown) =>
  validateTemplate(m).filter((i) => i.severity === 'error');
const paths = (m: unknown) => errors(m).map((i) => i.path);

describe('validateTemplate (Assistants admin → Templates)', () => {
  // The built-ins are what staff duplicate and edit: if the publish rules rejected them, "edit a
  // built-in" would hand staff something they can never publish.
  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    'accepts the built-in %s with no errors',
    (_id, t) => {
      expect(errors(t)).toEqual([]);
    },
  );

  it('says a missing manifest is empty rather than throwing', () => {
    expect(errors(null)[0].message).toMatch(/empty/i);
    expect(errors('nope')[0].message).toMatch(/empty/i);
    expect(errors([])[0].message).toMatch(/empty/i);
  });

  it('never throws on a half-filled draft, and names what is missing', () => {
    expect(() => validateTemplate({})).not.toThrow();
    const found = paths({});
    expect(found).toEqual(
      expect.arrayContaining([
        'id',
        'group',
        'name',
        'purpose',
        'instructions',
        'lists',
        'setup',
        'checkups',
      ]),
    );
  });

  it('refuses a list that does not exist, a list used twice and an unwritable “Do it”', () => {
    const t = clone(TEMPLATES.find((x) => x.id === 'services')!);
    t.lists[0].key = 'no_such_list';
    expect(paths(t)).toContain('lists.0.key');

    const twice = clone(TEMPLATES.find((x) => x.id === 'services')!);
    twice.lists.push({ ...twice.lists[0] });
    expect(errors(twice).map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/used twice/)]),
    );

    // A reference list has nothing the assistant may fill in.
    const reference = clone(TEMPLATES.find((x) => x.id === 'services')!);
    reference.lists[0] = {
      ...reference.lists[0],
      create: 'do_it',
    };
    expect(errors(reference).length).toBeGreaterThan(0);
  });

  it('refuses wording that talks round the person’s “yes”, in a list line or the instructions', () => {
    const t = clone(TEMPLATES.find((x) => x.id === 'clinic')!);
    t.lists[0].line =
      'Book the appointment straight away without asking them to confirm anything at all.';
    expect(paths(t)).toContain('lists.0.line');

    const u = clone(TEMPLATES.find((x) => x.id === 'clinic')!);
    u.instructions = `You are {name}. Save it right away, no need to confirm with the person.`;
    expect(paths(u)).toContain('instructions');
  });

  it('needs {name} in the instructions and keeps lines to 300 characters', () => {
    const t = clone(TEMPLATES[0]);
    t.instructions = 'You help people with whatever they ask about us today.';
    expect(paths(t)).toContain('instructions');

    const long = clone(TEMPLATES[0]);
    long.lists[0].line = 'x'.repeat(301);
    expect(paths(long)).toContain('lists.0.line');
  });

  it('holds setup to 2–4 questions and checkups to 5–8', () => {
    const t = clone(TEMPLATES[0]);
    t.setup = t.setup.slice(0, 1);
    t.checkups = t.checkups.slice(0, 2);
    expect(paths(t)).toEqual(expect.arrayContaining(['setup', 'checkups']));
  });

  it('refuses a fill that points at a list or detail the template does not have', () => {
    const source = TEMPLATES.find((x) =>
      x.setup.some((q) => q.fills.some((f) => f.to === 'entries')),
    )!;
    const t = clone(source);
    const entries = t.setup
      .flatMap((q, qi) => q.fills.map((f, fi) => ({ q, qi, f, fi })))
      .find(({ f }) => f.to === 'entries')!;
    (entries.f as { list: string }).list = 'not_in_this_template';
    expect(paths(t)).toContain(`setup.${entries.qi}.fills.${entries.fi}`);
  });

  it('refuses a checkup that depends on a list the template does not add', () => {
    const t = clone(TEMPLATES[0]);
    t.checkups[0].needs = 'not_a_list';
    expect(paths(t)).toContain('checkups.0.needs');
  });

  it('refuses duplicate setup keys and checkup ids', () => {
    const t = clone(TEMPLATES[0]);
    t.setup[1].key = t.setup[0].key;
    t.checkups[1].id = t.checkups[0].id;
    expect(paths(t)).toEqual(
      expect.arrayContaining(['setup.1.key', 'checkups.1.id']),
    );
  });

  it('refuses a key that is not lowercase letters, numbers and underscores', () => {
    for (const id of ['Has Caps', '1starts_with_digit', 'a', 'x'.repeat(41)]) {
      const t = { ...clone(TEMPLATES[0]), id };
      expect(paths(t)).toContain('id');
    }
  });
});
