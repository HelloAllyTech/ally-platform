import { KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import {
  KnowledgeReviewService,
  ownerTyped,
} from '../knowledge-review.service';
import { contactValuesIn, scanForPii } from '../pii-scan';

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
