import { READY_MADE, exampleOptions, stillExamples } from '../ready-made-lists';

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
});
