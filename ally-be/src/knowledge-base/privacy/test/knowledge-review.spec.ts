import { KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import {
  KnowledgeReviewService,
  ownerTyped,
} from '../knowledge-review.service';
import { contactValuesIn, inPublicRole, scanForPii } from '../pii-scan';

const CHATBOT = 'bot-1';

function setup(
  settings: {
    knowledgePublicContacts?: string[];
    humanContact?: Record<string, string>;
    helplineNumbers?: string;
  } = {},
  names: string[] = [],
) {
  const query = jest.fn(async (...args: [sql: string, params?: unknown[]]) => {
    const [sql] = args;
    if (sql.includes('FROM chatbots'))
      return [
        {
          v: settings.knowledgePublicContacts ?? null,
          hc: settings.humanContact ?? null,
          hn: settings.helplineNumbers ?? null,
        },
      ];
    return [];
  });
  const llm = {
    complete: jest.fn(async () => ({ text: JSON.stringify({ names }) })),
  };
  const service = new KnowledgeReviewService(
    { query } as never,
    { enqueue: jest.fn() } as never,
    llm as never,
    { get: () => undefined } as never,
  );
  const held = () =>
    query.mock.calls.some(([sql]) =>
      String(sql).includes("pii_review = 'needs_review'"),
    );
  return { service, query, llm, held };
}

const doc = (over: Record<string, unknown> = {}) =>
  ({
    id: 'doc-1',
    ownerChatbotId: CHATBOT,
    tags: ['onboarding'],
    piiReview: null,
    piiFindings: null,
    sourceType: KbDocumentSourceType.PASTE,
    sourceUrl: null,
    ...over,
  }) as never;

const NOTES =
  'Organisation name: Sunrise Listening Line\nHelpline number: 0800 123 4567, open 9am to 9pm every day';

const CUSTOMER_LIST = [
  'Client list',
  'Asha Verma, +91 98450 12345, asha.verma@gmail.com',
  'Rohan Iyer, +91 99001 23456',
  'Meera Pillai, 98860 34567',
].join('\n');

describe('KnowledgeReviewService.holdIfPersonal', () => {
  it('indexes Owner notes with a phone number, without review or a model call', async () => {
    const { service, held, llm } = setup();
    const result = await service.holdIfPersonal(
      doc({ tags: ['onboarding', 'owner-notes'] }),
      NOTES,
    );
    expect(result).toBe(false);
    expect(held()).toBe(false);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('indexes learned facts and other typed text with no source address', async () => {
    const a = setup();
    expect(
      await a.service.holdIfPersonal(
        doc({ tags: ['onboarding', 'learned-facts'] }),
        NOTES,
      ),
    ).toBe(false);
    const b = setup();
    expect(await b.service.holdIfPersonal(doc({ tags: [] }), NOTES)).toBe(
      false,
    );
    expect(a.held() || b.held()).toBe(false);
  });

  it('releases Owner notes held before the rule', async () => {
    const { service, query, held } = setup();
    const result = await service.holdIfPersonal(
      doc({ tags: ['onboarding', 'owner-notes'], piiReview: 'needs_review' }),
      NOTES,
    );
    expect(result).toBe(false);
    expect(held()).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('SET pii_review = NULL'),
      ),
    ).toBe(true);
  });

  it('still holds an uploaded file with several personal names and phones', async () => {
    const { service, held, query } = setup({}, ['Asha Verma', 'Rohan Iyer']);
    const result = await service.holdIfPersonal(
      doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
      CUSTOMER_LIST,
    );
    expect(result).toBe(true);
    expect(held()).toBe(true);
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("pii_review = 'needs_review'"),
    )!;
    const findings = JSON.parse(String(update[1]![2])).findings as {
      kind: string;
      count: number;
    }[];
    expect(findings.map((f) => f.kind).sort()).toEqual([
      'email',
      'name',
      'phone',
    ]);
    expect(findings.find((f) => f.kind === 'phone')!.count).toBe(3);
  });

  it('still holds a crawled page (pasted text with a source address) with personal phones', async () => {
    const { service, held } = setup();
    expect(
      await service.holdIfPersonal(
        doc({ sourceUrl: 'https://example.org/team' }),
        CUSTOMER_LIST,
      ),
    ).toBe(true);
    expect(held()).toBe(true);
  });

  it("does not hold a crawled page whose only number is the chatbot's own helpline or human contact", async () => {
    const page =
      'Call us on +44 800 123 4567 any day, or write to hello@sunrise.org. Our front desk: 020 7946 0018.';
    const { service, held } = setup({
      helplineNumbers: '0800 123 4567, open 9am to 9pm every day',
      humanContact: { phone: '020 7946 0018', email: 'hello@sunrise.org' },
    });
    expect(
      await service.holdIfPersonal(
        doc({ sourceUrl: 'https://sunrise.org/contact' }),
        page,
      ),
    ).toBe(false);
    expect(held()).toBe(false);
  });

  it('holds a crawled page with other numbers beside the helpline', async () => {
    const { service } = setup({ helplineNumbers: '0800 123 4567' });
    expect(
      await service.holdIfPersonal(
        doc({ sourceUrl: 'https://sunrise.org/contact' }),
        'Helpline 0800 123 4567. Volunteer Asha: 98450 12345.',
      ),
    ).toBe(true);
  });
});

// TF1 F4: every organisation PDF was held for its own front desk number and info@ address.
describe('an organisation’s own published contacts in an uploaded file (TF1 F4)', () => {
  const BROCHURE =
    'Saathi Youth Helpline. Call +91 20 4860 2525, 10 am to 10 pm. Write to listen@saathi-youth.example.';

  it('are not held when there are only a few of them', async () => {
    const { service, held } = setup();
    expect(
      await service.holdIfPersonal(
        doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
        BROCHURE,
      ),
    ).toBe(false);
    expect(held()).toBe(false);
  });

  it('a longer list of numbers still is', async () => {
    const { service } = setup();
    const many = [1, 2, 3, 4, 5]
      .map((n) => `Member ${n}: +91 98450 1234${n}`)
      .join('\n');
    expect(
      await service.holdIfPersonal(
        doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
        many,
      ),
    ).toBe(true);
  });

  it('an identity number still is', async () => {
    const { service } = setup();
    expect(
      await service.holdIfPersonal(
        doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
        `${BROCHURE} Aadhaar 2345 6789 0123.`,
      ),
    ).toBe(true);
  });
});

describe('ownerTyped', () => {
  it('tells typed text from uploads and crawled pages', () => {
    expect(ownerTyped({ tags: ['owner-notes'] })).toBe(true);
    expect(ownerTyped({ sourceType: KbDocumentSourceType.PASTE })).toBe(true);
    expect(
      ownerTyped({
        sourceType: KbDocumentSourceType.PASTE,
        sourceUrl: 'https://x.org',
      }),
    ).toBe(false);
    expect(ownerTyped({ sourceType: KbDocumentSourceType.DOCX })).toBe(false);
    expect(ownerTyped({ sourceType: KbDocumentSourceType.URL })).toBe(false);
    expect(ownerTyped({})).toBe(false);
  });
});

describe('contactValuesIn', () => {
  it('pulls numbers and addresses out of a helpline setting', () => {
    const values = contactValuesIn(
      '0800 123 4567, open 9am to 9pm every day; or help@sunrise.org',
    );
    expect(values).toContain('help@sunrise.org');
    expect(scanForPii('Ring 0800 123 4567', values).total).toBe(0);
  });
});

// TF1 round 2, N-3: Sahyog's own PDF was held for its centre numbers, complaints email and the
// named centre manager.
describe('an organisation’s own contacts and named staff roles (TF1 round 2, N-3)', () => {
  const SAHYOG = [
    'Sahyog Disability Services. All our services are free.',
    'Malviya Nagar centre Plot 14, Sector 5, Malviya Nagar, Jaipur 302017 Monday to Saturday, 9:30 am to 5:30 pm +91 141 400 7110',
    'Sanganer centre Near Bus Stand, Tonk Road, Sanganer, Jaipur 302029 Tuesday to Saturday, 10 am to 4 pm +91 141 400 7220',
    'Complaints',
    'Write to the centre manager, Ms. Kavita Meena, at feedback@sahyog-jaipur.example. We reply within 7 days.',
  ].join('\n');

  it('does not hold the organisation’s PDF for its centres, its mailbox and its centre manager', async () => {
    const { service, held } = setup({}, ['Kavita Meena']);
    expect(
      await service.holdIfPersonal(
        doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
        SAHYOG,
      ),
    ).toBe(false);
    expect(held()).toBe(false);
  });

  it('finds no personal contact in it at all', () => {
    expect(scanForPii(SAHYOG).total).toBe(0);
  });

  it('still holds a named member of the public in the same document', async () => {
    const { service, held } = setup({}, ['Kavita Meena', 'Ramesh Gupta']);
    expect(
      await service.holdIfPersonal(
        doc({ sourceType: KbDocumentSourceType.PDF, tags: [] }),
        `${SAHYOG}\nRamesh Gupta was given a wheelchair in March.`,
      ),
    ).toBe(true);
    expect(held()).toBe(true);
  });

  it('still holds an Aadhaar or PAN number', () => {
    expect(
      scanForPii(
        `${SAHYOG}\nAadhaar 2345 6789 0123, PAN ABCDE1234F`,
      ).findings.map((f) => f.kind),
    ).toEqual(['id_number']);
  });

  it('a list of numbers in one sentence is still personal', () => {
    expect(
      scanForPii(
        'Patients at our centre: Asha 98450 12345, Rohan 99001 23456, Meera 98860 34567',
      ).total,
    ).toBe(3);
  });

  it('tells a staff role from a private mention', () => {
    expect(inPublicRole(SAHYOG, 'Kavita Meena')).toBe(true);
    expect(inPublicRole(SAHYOG, 'Ms. Kavita Meena')).toBe(true);
    expect(inPublicRole('Dr Rao, our dentist, sees children.', 'Rao')).toBe(
      true,
    );
    expect(
      inPublicRole(
        'Write to the centre manager, Ms. Kavita Meena. Kavita Meena’s son was treated here.',
        'Kavita Meena',
      ),
    ).toBe(false);
    expect(
      inPublicRole('Ramesh Gupta was given a wheelchair.', 'Ramesh Gupta'),
    ).toBe(false);
  });
});
