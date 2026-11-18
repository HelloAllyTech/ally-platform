import {
  NEUTRAL_APPOINTMENT_SERVICES,
  APPOINTMENT_EXAMPLES,
  READY_MADE,
  businessKind,
  exampleOptions,
  listInputFor,
  stillExamples,
} from '../ready-made-lists';

/** Chunk 6b, item 30: example choices fit each list, and never reach a visitor. */
describe('ready-made example choices', () => {
  it("Leads' examples fit any business, not a clinic's", () => {
    const leads = READY_MADE.find((item) => item.name === 'leads')!;
    expect(exampleOptions(leads)).toEqual([
      {
        list: 'leads',
        field: 'interest',
        label: 'Interest',
        examples: ['A demo', 'Pricing', 'Something else'],
      },
    ]);
  });

  it('no required choice the assistant fills in installs with examples', () => {
    const offenders = READY_MADE.flatMap((item) =>
      item.lists.flatMap((list) =>
        list.fields
          .filter((f) => f.example_options && f.required && f.agent_write)
          .map((f) => `${list.key}.${f.key}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('recognises every example set, now and before', () => {
    expect(stillExamples(['A demo', 'Pricing', 'Something else'])).toBe(true);
    expect(stillExamples(['Consultation', 'Follow-up', 'Check-up'])).toBe(true);
    expect(
      stillExamples([
        'Individual therapy',
        'Couples therapy',
        'Family therapy',
      ]),
    ).toBe(true);
    expect(stillExamples(['A demo', 'Pricing'])).toBe(false);
    expect(stillExamples([])).toBe(false);
  });

  describe("Appointments' examples fit the business (Q3d; prod 18 Nov)", () => {
    it.each([
      [{ industry: 'mental_health' }, 'therapy'],
      [{ safetyPack: 'mental_health', text: 'Eye care' }, 'therapy'],
      [{ industry: 'gp_clinic', text: 'Sunrise Family Clinic' }, 'clinic'],
      [{ industry: 'gp_clinic', text: 'Centre for Sight Eye Hospital' }, 'eye'],
      [{ industry: 'other', text: 'LASIK and cataract surgery' }, 'eye'],
      [{ industry: 'wellness', text: 'Looks Salon' }, 'salon'],
      [{ industry: 'other', text: 'BHIVE Workspace' }, 'coworking'],
      [{ text: 'Co-working desks in Indiranagar' }, 'coworking'],
      [{ industry: 'diagnostic_lab' }, 'lab'],
      [{ industry: 'school' }, 'education'],
      [{ industry: 'saas', text: 'Ledgerly' }, 'generic'],
      [{}, 'generic'],
    ])('%j is %s', (input, kind) => {
      expect(businessKind(input)).toBe(kind);
    });

    it('no business but a therapy practice is offered therapy', () => {
      const therapy = APPOINTMENT_EXAMPLES.therapy;
      for (const [kind, values] of Object.entries(APPOINTMENT_EXAMPLES)) {
        if (kind === 'therapy') continue;
        expect(values.some((v) => therapy.includes(v))).toBe(false);
        expect(values.join(' ')).not.toMatch(/therapy/i);
      }
    });

    it('"Make it yours" shows the examples that fit, and they install', () => {
      const item = READY_MADE.find((i) => i.name === 'appointments')!;
      expect(exampleOptions(item, 'eye')[0].examples).toEqual([
        'Eye check-up',
        'LASIK consultation',
        'Cataract consultation',
      ]);
      // Without a kind the catalogue's are neutral, never therapy services (Q3-fast).
      expect(exampleOptions(item)[0].examples).toEqual(
        NEUTRAL_APPOINTMENT_SERVICES,
      );
      expect(APPOINTMENT_EXAMPLES.generic).toEqual([
        'Consultation',
        'Follow-up',
        'Something else',
      ]);
      const list = item.lists.find((l) => l.key === 'appointments')!;
      const { fields = [] } = listInputFor(list, {
        options: { service: APPOINTMENT_EXAMPLES.salon },
      });
      const service = fields.find((f) => f.key === 'service');
      expect(service?.options).toEqual({ values: APPOINTMENT_EXAMPLES.salon });
    });

    it('every set is recognised as examples, so an untouched one is never offered', () => {
      for (const values of Object.values(APPOINTMENT_EXAMPLES)) {
        expect(stillExamples(values)).toBe(true);
      }
    });
  });
});
