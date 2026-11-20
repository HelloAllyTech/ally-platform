import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PurposeId,
  SafetyPackId,
} from '../../../bot-draft/enum/bot-draft.enum';
import { HEALTH_PACKS, READY_MADE } from '../../lists/ready-made-lists';
import { listDefinition, TEMPLATE_LISTS } from '../template-lists';
import {
  itemsOf,
  moneyOf,
  partsOf,
  planInstall,
  resolveWhen,
  type SetupAnswers,
} from '../template-plan';
import {
  ORGANISATION_USE_CASES,
  TEMPLATES,
  type UseCaseTemplate,
} from '../templates';

const ZONE = 'Asia/Kolkata';
const NOW = new Date('2026-11-20T06:00:00Z'); // a Friday in India
const byId = (rows: { id: string }[]) => rows.map((r) => [r.id, r] as const);

/** A full set of answers for a template: each question answered in the shape it asks for. */
function sampleAnswers(t: UseCaseTemplate): SetupAnswers {
  const out: SetupAnswers = {};
  for (const q of t.setup) {
    if (q.kind === 'yes_no') out[q.key] = true;
    else if (q.kind === 'choices') out[q.key] = [q.choices![0]];
    else out[q.key] = 'First thing - 1200\nSecond thing - 2500';
  }
  return out;
}

/** Wording that would talk the assistant round the customer's "yes" (H1). */
const AROUND_THE_YES =
  /without (asking|checking|confirm)|no need to (ask|check|confirm)|straight ?away|right away|immediately (book|save|cancel)|skip (the )?confirm|don.t (ask|wait) (for|to) (a |the )?(yes|confirm)|assume (they|the person) (agree|said yes)/i;

describe('Use-case templates (T1)', () => {
  describe('organisations: the sign-in page’s six, from one shared source', () => {
    it('ally-be reads the same file the sign-in page copies', () => {
      const shared = JSON.parse(
        readFileSync(join(__dirname, '../organisation-use-cases.json'), 'utf8'),
      );
      expect(ORGANISATION_USE_CASES).toEqual(shared);
      expect(shared).toHaveLength(6);
    });

    it('has the sign-in page’s names and one-liners, in its order, first', () => {
      const orgs = TEMPLATES.filter((t) => t.group === 'organisations');
      expect(orgs.map((t) => [t.id, t.name, t.one_liner])).toEqual(
        ORGANISATION_USE_CASES.map((u) => [u.id, u.title, u.blurb]),
      );
      expect(TEMPLATES.slice(0, 6).map((t) => t.group)).toEqual(
        Array(6).fill('organisations'),
      );
    });

    it('fails if the web app’s copy drifts from ally-be’s (when the monorepo is checked out)', () => {
      const web = join(
        __dirname,
        '../../../../../ally-web/apps/ally-admin-dashboard/src/constants/organisationUseCases.json',
      );
      expect(JSON.parse(readFileSync(web, 'utf8'))).toEqual(
        ORGANISATION_USE_CASES,
      );
    });
  });

  it('has 6 organisation and 11 business templates, with unique ids', () => {
    expect(TEMPLATES.filter((t) => t.group === 'organisations')).toHaveLength(
      6,
    );
    expect(TEMPLATES.filter((t) => t.group === 'businesses')).toHaveLength(11);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.every((t) => t.id.length <= 40)).toBe(true);
  });

  it('keeps template-only list keys apart from the ready-made catalogue', () => {
    const ready = new Set(READY_MADE.flatMap((i) => i.lists.map((l) => l.key)));
    for (const list of TEMPLATE_LISTS) expect(ready.has(list.key)).toBe(false);
  });

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (_id, t) => {
    it('has a real purpose and pack, and 2–4 setup and 5–8 checkup questions', () => {
      expect(Object.values(PurposeId)).toContain(t.purpose);
      if (t.pack) expect(Object.values(SafetyPackId)).toContain(t.pack);
      expect(t.setup.length).toBeGreaterThanOrEqual(2);
      expect(t.setup.length).toBeLessThanOrEqual(4);
      expect(t.checkups.length).toBeGreaterThanOrEqual(5);
      expect(t.checkups.length).toBeLessThanOrEqual(8);
      expect(new Set(t.checkups.map((c) => c.id)).size).toBe(t.checkups.length);
      expect(new Set(t.setup.map((q) => q.key)).size).toBe(t.setup.length);
    });

    it('uses lists that exist, with Do it only where the assistant can fill something in', () => {
      for (const use of t.lists) {
        const def = listDefinition(use.key);
        expect(def).toBeDefined();
        for (const a of [use.find, use.create, use.update]) {
          expect(['do_it', 'never']).toContain(a);
        }
        const writable = def!.fields.some((f) => f.agent_write);
        if (use.create === 'do_it' || use.update === 'do_it') {
          expect(writable).toBe(true);
        }
        // A list pointing at another one needs that one installed first.
        for (const f of def!.fields) {
          const to = f.options?.to as string | undefined;
          if (f.type === 'relation' && to && to !== 'contact') {
            const keys = t.lists.map((l) => l.key);
            expect(keys.indexOf(to)).toBeGreaterThanOrEqual(0);
            expect(keys.indexOf(to)).toBeLessThan(keys.indexOf(use.key));
          }
        }
      }
    });

    it('writes every list a line of at most 300 characters, never wording around the “yes”', () => {
      for (const use of t.lists) {
        expect(use.line.trim().length).toBeGreaterThan(20);
        expect(use.line.length).toBeLessThanOrEqual(300);
        expect(use.line).not.toMatch(AROUND_THE_YES);
      }
      expect(t.instructions).not.toMatch(AROUND_THE_YES);
      expect(t.instructions).toContain('{name}');
    });

    it('fills only details and choices its lists have', () => {
      const keys = new Set(t.lists.map((l) => l.key));
      for (const q of t.setup) {
        for (const fill of q.fills) {
          if ('list' in fill) {
            expect(keys.has(fill.list)).toBe(true);
            const def = listDefinition(fill.list)!;
            const fieldKeys = def.fields.map((f) => f.key);
            if ('columns' in fill) {
              for (const c of fill.columns) expect(fieldKeys).toContain(c);
            }
            if ('field' in fill) expect(fieldKeys).toContain(fill.field);
            if (fill.to === 'options') {
              const field = def.fields.find((f) => f.key === fill.field)!;
              expect(field.example_options).toBe(true);
            }
          }
          if (fill.to === 'list') {
            expect(t.lists.some((l) => l.only_if === q.key)).toBe(true);
          }
        }
        if (q.kind === 'choices') expect(q.choices?.length).toBeGreaterThan(0);
      }
      for (const use of t.lists) {
        const fieldKeys = listDefinition(use.key)!.fields.map((f) => f.key);
        for (const row of use.examples ?? []) {
          for (const k of Object.keys(row)) expect(fieldKeys).toContain(k);
        }
      }
    });

    it.each([
      ['every question skipped', () => ({})],
      ['every question answered', () => sampleAnswers(t)],
    ])('plans its install with %s', (_label, answers) => {
      const plan = planInstall(t, answers(), { zone: ZONE, now: NOW });
      expect(plan.cases.length).toBeGreaterThanOrEqual(
        Math.min(5, t.checkups.filter((c) => !c.needs).length),
      );
      for (const c of plan.cases) {
        expect(c.question).not.toMatch(/[{}]/);
        expect(c.facts.length).toBeGreaterThan(0);
        for (const f of c.facts) expect(f).not.toMatch(/[{}]|\|\|/);
      }
      // The pack is never weaker than the template's own.
      if (t.pack) expect(plan.pack).toBe(t.pack);
    });

    it('marks every planned example as one, and every answer as the owner’s', () => {
      const skipped = planInstall(t, {}, { zone: ZONE, now: NOW });
      for (const rows of Object.values(skipped.entries)) {
        expect(rows.every((r) => r.example)).toBe(true);
      }
      const answered = planInstall(t, sampleAnswers(t), {
        zone: ZONE,
        now: NOW,
      });
      for (const q of t.setup) {
        for (const fill of q.fills) {
          if (fill.to === 'entries') {
            expect(answered.entries[fill.list].every((r) => !r.example)).toBe(
              true,
            );
          }
        }
      }
    });
  });

  it('crisis templates carry the owner’s helpline number into every crisis reply', () => {
    for (const id of ['helpline', 'practice']) {
      const t = TEMPLATES.find((x) => x.id === id)!;
      expect(t.pack).toBe(SafetyPackId.MENTAL_HEALTH);
      const plan = planInstall(
        t,
        { helpline: '1800-123-4567, open 24 hours' },
        { zone: ZONE, now: NOW },
      );
      expect(plan.helpline).toBe('1800-123-4567, open 24 hours');
      const crisis = plan.cases.find((c) => c.expect === 'crisis_only')!;
      expect(crisis.hardFail).toBe(true);
      expect(crisis.facts.join(' ')).toContain('1800-123-4567');
    }
  });

  it('health templates never let the assistant write a field that could hold symptoms', () => {
    for (const t of TEMPLATES.filter(
      (x) => x.pack && HEALTH_PACKS.has(x.pack),
    )) {
      for (const use of t.lists) {
        const def = listDefinition(use.key)!;
        for (const f of def.fields) {
          if (f.privacy?.never_store) expect(f.agent_write).toBeFalsy();
        }
      }
    }
  });

  it('a yes to “benefits or legal aid” asks for Legal and financial care', () => {
    const services = TEMPLATES.find((t) => t.id === 'services')!;
    expect(planInstall(services, { benefits: true }, { zone: ZONE }).pack).toBe(
      SafetyPackId.LEGAL_FINANCIAL,
    );
    expect(
      planInstall(services, { benefits: false }, { zone: ZONE }).pack,
    ).toBeNull();
  });

  it('installs Questions for the team only when the owner says yes', () => {
    const t = TEMPLATES.find((x) => x.id === 'training')!;
    const keys = (a: SetupAnswers) =>
      planInstall(t, a, { zone: ZONE }).lists.map((l) => l.use.key);
    expect(keys({ collect: true })).toEqual(['team_questions']);
    expect(keys({ collect: false })).toEqual([]);
    expect(
      planInstall(t, { collect: false }, { zone: ZONE }).cases.map((c) => c.id),
    ).not.toContain('pass_on');
  });

  it('uses only neutral examples: no word outside the reviewed set', () => {
    const words = new Set(
      TEMPLATES.flatMap((t) => t.lists.flatMap((l) => l.examples ?? []))
        .flatMap((row) => Object.values(row))
        .filter((v): v is string => typeof v === 'string' && !v.startsWith('@'))
        .flatMap((v) => v.match(/[A-Za-z’']+/g) ?? [])
        .map((w) => w.toLowerCase()),
    );
    // The words in T1-TEMPLATE-TEXTS.md's "Neutral examples". A new word is a review question.
    const REVIEWED = new Set(
      `service anyone living in the area a photo id centre mon fri sat free families with children
      under and proof of address example road street bank transfer ask team for account details
      online through donate page on our website cheque payable to organisation posted or handed at
      office weekend update replace this what’s changed dish drink bhk rent sale product demo
      class teacher beginners’ all beginner shift mains starters drinks veg`.split(
        /\s+/,
      ),
    );
    expect([...words].filter((w) => !REVIEWED.has(w))).toEqual([]);
  });

  describe('reading the owner’s answers', () => {
    it('splits lines, or one line at its commas', () => {
      expect(itemsOf('Consultation, Follow-up')).toEqual([
        'Consultation',
        'Follow-up',
      ]);
      expect(itemsOf('- Haircut - 300\n• Facial: 900\n\n')).toEqual([
        'Haircut - 300',
        'Facial: 900',
      ]);
    });

    it('splits a line into its parts', () => {
      expect(partsOf('Haircut - 300')).toEqual(['Haircut', '300']);
      expect(partsOf('Centre 1 – 12 Station Road – Mon–Fri 10–5')).toEqual([
        'Centre 1',
        '12 Station Road',
        'Mon–Fri 10–5',
      ]);
      expect(partsOf('Follow-up: 500')).toEqual(['Follow-up', '500']);
    });

    it('reads amounts in rupees, lakh and crore', () => {
      expect(moneyOf('₹1,200')).toBe(1200);
      expect(moneyOf('85 lakh')).toBe(8_500_000);
      expect(moneyOf('1.2 crore')).toBe(12_000_000);
      expect(moneyOf('Free')).toBeNull();
    });

    it('puts example times on the next Saturday in the business’s zone', () => {
      expect(resolveWhen('@saturday 10:00', ZONE, NOW)).toBe(
        '2026-11-21T10:00:00+05:30',
      );
      expect(resolveWhen('@today', ZONE, NOW)).toBe('2026-11-20');
      expect(resolveWhen('plain', ZONE, NOW)).toBe('plain');
    });

    it('turns a price list answer into entries with amounts', () => {
      const salon = TEMPLATES.find((t) => t.id === 'salon')!;
      const plan = planInstall(
        salon,
        { prices: 'Haircut - 300\nFacial - ₹1,200' },
        { zone: ZONE },
      );
      expect(plan.entries.price_list).toEqual([
        { values: { service: 'Haircut', price: 300 }, example: false },
        { values: { service: 'Facial', price: 1200 }, example: false },
      ]);
      expect(plan.options.appointments.service).toEqual(['Haircut', 'Facial']);
      expect(plan.cases.find((c) => c.id === 'price')!.question).toBe(
        'How much is Haircut?',
      );
    });
  });

  it('lists every template once by id', () => {
    expect(new Map(byId(TEMPLATES)).size).toBe(17);
  });
});
