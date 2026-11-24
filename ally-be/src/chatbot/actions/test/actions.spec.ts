import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import type { WriteOffer } from '../../agent-tools/list-consent';
import { tapRunIdFor } from '../../agent-tools/agent-gateway.service';
import {
  appConfig,
  BOT_A,
  CONV_A,
  CONV_B,
  makeGateway,
  RecordingTool,
} from '../../agent-tools/test/agent-tools.fakes';
import { ActionPartsService, entryCard } from '../action-parts.service';
import { ActionTokenService, type ActionClaims } from '../action-token.service';
import { ActionsService, plainReason } from '../actions.service';

/** Redis as the action tokens use it: get, set and SET NX over a Map. */
const redis = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    acquireLock: jest.fn(async (key: string) => {
      if (store.has(key)) return false;
      store.set(key, '1');
      return true;
    }),
  };
};

const CONTACT = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const where = { chatbotId: BOT_A, conversationId: CONV_A, contactId: CONTACT };

const offer = (overrides: Partial<WriteOffer> = {}): WriteOffer => ({
  id: 'offer-1',
  runId: 'run-asked',
  tool: 'note_it',
  key: 'k',
  list: 'Registrations',
  questions: {
    en: 'Shall I register you for Sun 29 Nov 2026, 11:00?',
    hi: 'क्या मैं आपको रजिस्टर कर दूँ?',
  },
  createdAt: Date.now(),
  input: { note: 'register' },
  card: {
    action: 'create',
    list: 'Registrations',
    title: 'Sun 29 Nov 2026, 11:00',
    headline: 'registered',
    details: [
      { label: 'When', value: 'Sun 29 Nov 2026, 11:00' },
      { label: 'Where', value: 'Bandra West station' },
    ],
  },
  ...overrides,
});

describe('ActionTokenService (BT1: signed, single-use, 30 minutes)', () => {
  const tokens = () => new ActionTokenService(appConfig(), redis() as never);
  const claims = (overrides: Partial<ActionClaims> = {}): ActionClaims => ({
    kind: 'ask',
    text: 'Is the helpline open now?',
    ...where,
    ...overrides,
  });

  it('is short enough for a WhatsApp row id, and redeems once as the first use', async () => {
    const t = tokens();
    const token = (await t.issue(claims()))!;
    expect(token.length).toBeLessThanOrEqual(64);
    const first = await t.redeem(token, where);
    expect(first).toMatchObject({ ok: true, firstUse: true });
    const second = await t.redeem(token, where);
    expect(second).toMatchObject({ ok: true, firstUse: false });
  });

  it("refuses another chat's or another person's tap, a forged one and an expired one", async () => {
    const t = tokens();
    const token = (await t.issue(claims()))!;
    expect(await t.redeem(token, { ...where, conversationId: CONV_B })).toEqual(
      { ok: false, reason: 'not_yours' },
    );
    expect(await t.redeem(token, { ...where, contactId: 'someone' })).toEqual({
      ok: false,
      reason: 'not_yours',
    });
    const [id] = token.split('.');
    expect(await t.redeem(`${id}.forged`, where)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // Signed, but its claims are gone (30 minutes passed).
    const other = tokens();
    const lost = (await other.issue(claims()))!;
    (other as any).redis.store.clear();
    expect(await other.redeem(lost, where)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('AgentGatewayService.confirmOffer (BT1: the tap is the yes, written once)', () => {
  it('writes through the same tool with the offer as consent, and a second tap replays it', async () => {
    const tool = new RecordingTool('note_it');
    const { gateway, db } = makeGateway([tool]);
    db.bots.set(BOT_A, { abilities: { note_it: 'do_it' } as never });
    const first = await gateway.confirmOffer(where, offer());
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(tool.calls).toHaveLength(1);
    expect(tool.calls[0].ctx).toMatchObject({
      consentOfferId: 'offer-1',
      runId: tapRunIdFor('offer-1'),
      contactId: CONTACT,
    });
    const again = await gateway.confirmOffer(where, offer());
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(tool.calls).toHaveLength(1);
  });

  it('writes nothing when the tool is off, or the offer has nothing to replay', async () => {
    const tool = new RecordingTool('note_it');
    const { gateway, db } = makeGateway([tool]);
    db.bots.set(BOT_A, { abilities: { note_it: 'never' } as never });
    expect(await gateway.confirmOffer(where, offer())).toMatchObject({
      ok: false,
      error: 'tool_off',
    });
    db.bots.set(BOT_A, { abilities: { note_it: 'do_it' } as never });
    expect(
      await gateway.confirmOffer(where, offer({ input: undefined })),
    ).toMatchObject({ ok: false, error: 'not_tappable' });
    expect(tool.calls).toHaveLength(0);
  });
});

describe('ActionsService (BT1: taps answered in code)', () => {
  const turn = (tap: unknown, text = 'Confirmed: Sun 29 Nov 2026, 11:00') =>
    ({
      chatbot: { id: BOT_A },
      conversationId: CONV_A,
      contactId: CONTACT,
      text,
      tap,
    }) as never;

  const setup = (outcome: unknown) => {
    const gateway = { confirmOffer: jest.fn().mockResolvedValue(outcome) };
    const listTools = {
      confirmation: jest.fn().mockResolvedValue({
        list: 'Registrations',
        title: 'Sun 29 Nov 2026, 11:00',
        headline: 'registered',
        details: [
          { label: 'When', value: 'Sun 29 Nov 2026, 11:00' },
          { label: 'Where', value: 'Bandra West station' },
        ],
      }),
    };
    const consent = { consume: jest.fn() };
    const service = new ActionsService(
      gateway as never,
      listTools as never,
      {} as never,
      consent as never,
    );
    return { service, gateway, listTools, consent };
  };

  it('Confirm writes the shown offer and says it is done, with the card behind it', async () => {
    const shown = offer();
    const { service, gateway } = setup({
      ok: true,
      replayed: false,
      result: { passages: [{ record_id: 'r-1' }] },
    });
    const decision = await service.perform(
      turn({
        ok: true,
        firstUse: true,
        claims: { kind: 'confirm', text: '', offer: shown, ...where },
      }),
    );
    expect(gateway.confirmOffer).toHaveBeenCalledWith(where, shown);
    expect(decision).toMatchObject({
      handledBy: WaHandledBy.TAP,
      body: "Done: you're registered for Sun 29 Nov 2026, 11:00, Bandra West station.",
      agent: {
        runId: tapRunIdFor('offer-1'),
        activity: [{ kind: 'create', record_id: 'r-1' }],
      },
    });
  });

  it('a slot taken in the meantime is said plainly; its free times come back as chips', async () => {
    const { service } = setup({
      ok: false,
      error: 'capacity_full',
      replayed: false,
      result: { passages: [{ record_id: 'r-2' }, { record_id: 'r-3' }] },
    });
    const decision = await service.perform(
      turn({
        ok: true,
        firstUse: true,
        claims: { kind: 'confirm', text: '', offer: offer(), ...where },
      }),
    );
    expect(decision?.body).toBe(
      'That time was just taken. Here are other free times:',
    );
    expect(decision?.agent?.runId).toBe(tapRunIdFor('offer-1'));
  });

  it('an old or foreign button says so; Keep it drops the pending cancel; a reused chip does nothing', async () => {
    const { service, consent } = setup({});
    expect(
      (await service.perform(turn({ ok: false, reason: 'expired' }, 'x')))
        ?.body,
    ).toMatch(/expired/);
    expect(
      (await service.perform(turn({ ok: false, reason: 'not_yours' }, 'x')))
        ?.body,
    ).toMatch(/isn't for this chat/);
    const kept = await service.perform(
      turn(
        {
          ok: true,
          firstUse: true,
          claims: { kind: 'keep', text: 'Keep it.', ...where },
        },
        'Keep it.',
      ),
    );
    expect(kept?.body).toMatch(/No change/);
    expect(consent.consume).toHaveBeenCalledWith(BOT_A, CONV_A);
    expect(
      (
        await service.perform(
          turn(
            {
              ok: true,
              firstUse: false,
              claims: { kind: 'choose', text: 'Sun', ...where },
            },
            'Sun',
          ),
        )
      )?.body,
    ).toBe('That is already done.');
  });

  it('a chip, Change, Cancel and Move are answered like their words (the agent; its write asks again)', async () => {
    const { service } = setup({});
    for (const kind of ['choose', 'change', 'cancel', 'move', 'ask'] as const) {
      expect(
        await service.perform(
          turn(
            { ok: true, firstUse: true, claims: { kind, text: 'x', ...where } },
            'x',
          ),
        ),
      ).toBeNull();
    }
  });
});

describe('ActionPartsService (BT1: chips and cards from tool results, never from text)', () => {
  const LIST = {
    key: 'registrations',
    name: 'Registrations',
    fields: [
      {
        key: 'event',
        label: 'Event',
        type: 'relation',
        options: { to: 'events' },
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: { values: ['registered', 'cancelled'] },
      },
    ],
    settings: {},
  };

  const setup = (rows: unknown[], current: WriteOffer | null = null) => {
    const r = redis();
    const tokens = new ActionTokenService(appConfig(), r as never);
    const db = {
      query: jest.fn(async (sql: string) =>
        /FROM tool_runs/.test(sql)
          ? rows
          : [{ settings: { abilities: { update_registrations: 'do_it' } } }],
      ),
    };
    const definitions = { getList: jest.fn().mockResolvedValue(LIST) };
    const consent = { current: jest.fn().mockResolvedValue(current) };
    const parts = new ActionPartsService(
      db as never,
      tokens,
      definitions as never,
      consent as never,
    );
    return { parts, tokens, redis: r };
  };
  const input = (overrides: Record<string, unknown> = {}) => ({
    ...where,
    runId: 'run-asked',
    language: 'en' as const,
    suppressed: false,
    answered: true,
    ...overrides,
  });

  it('a write held for a yes: the card from the dry-run entry, Confirm and Change', async () => {
    const { parts, tokens } = setup(
      [
        {
          tool: 'create_registrations',
          status: 'error',
          error_code: 'needs_confirmation',
          result: {},
        },
      ],
      offer(),
    );
    const out = await parts.partsFor(input());
    expect(out.offer).toMatchObject({
      question: 'Shall I register you for Sun 29 Nov 2026, 11:00?',
      card: { title: 'Sun 29 Nov 2026, 11:00', list: 'Registrations' },
    });
    expect(out.offer!.buttons.map((b) => b.label)).toEqual([
      'Confirm',
      'Change',
    ]);
    const redeemed = await tokens.redeem(out.offer!.buttons[0].token, where);
    expect(redeemed).toMatchObject({
      ok: true,
      claims: { kind: 'confirm', text: 'Confirmed: Sun 29 Nov 2026, 11:00' },
    });
  });

  it('an offer another run made, or one without a card, gets no buttons', async () => {
    const { parts } = setup(
      [
        {
          tool: 'create_registrations',
          status: 'error',
          error_code: 'needs_confirmation',
          result: {},
        },
      ],
      offer({ runId: 'another-run' }),
    );
    expect((await parts.partsFor(input())).offer).toBeUndefined();
  });

  it('a write made: Cancel and Move on the done card', async () => {
    const { parts } = setup([
      {
        tool: 'create_registrations',
        status: 'ok',
        error_code: null,
        result: {
          list: { key: 'registrations', name: 'Registrations' },
          passages: [
            {
              record_id: 'r-1',
              record_title: 'Sun 29 Nov 2026, 11:00',
              text: 'Status: registered',
            },
          ],
        },
      },
    ]);
    const out = await parts.partsFor(input());
    expect(out.done?.buttons.map((b) => b.label)).toEqual(['Cancel', 'Move']);
  });

  it('a lookup: chips with the day and time from the entries, and one entry as its card', async () => {
    const found = (n: number) => [
      {
        tool: 'find_events',
        status: 'ok',
        error_code: null,
        result: {
          list: { key: 'events', name: 'Food drives' },
          passages: Array.from({ length: n }, (_, i) => ({
            record_id: `e-${i}`,
            record_title: `Sun 29 Nov 2026, 1${i}:00`,
            text: `id: e-${i}\nVenue: Bandra West station\nPlaces left: 4`,
          })),
        },
      },
    ];
    const many = await setup(found(12)).parts.partsFor(input());
    expect(many.choices?.options).toHaveLength(8);
    expect(many.choices?.options[0].label).toBe('Sun 29 Nov · 10:00');
    const one = await setup(found(1)).parts.partsFor(input());
    expect(one.entry).toEqual({
      list: 'Food drives',
      title: 'Sun 29 Nov 2026, 10:00',
      details: [
        { label: 'Venue', value: 'Bandra West station' },
        { label: 'Places left', value: '4' },
      ],
    });
  });

  it('entries named alike show their day and time; the tap says name, time and place', async () => {
    const { parts, tokens } = setup([
      {
        tool: 'find_events',
        status: 'ok',
        error_code: null,
        result: {
          list: { key: 'events', name: 'Food drives' },
          passages: [10, 12].map((h) => ({
            record_id: `e-${h}`,
            record_title: 'Bandra Sunday food drive',
            text: `id: e-${h}\nStarts at: Sun 29 Nov 2026, ${h}:00\nVenue: Bandra West station`,
          })),
        },
      },
    ]);
    const out = await parts.partsFor(input());
    expect(out.choices?.options.map((o) => o.label)).toEqual([
      'Sun 29 Nov · 10:00',
      'Sun 29 Nov · 12:00',
    ]);
    const tapped = await tokens.redeem(out.choices!.options[1].token, where);
    expect(tapped).toMatchObject({
      ok: true,
      claims: {
        text: 'Bandra Sunday food drive, Sun 29 Nov 2026, 12:00, Bandra West station',
      },
    });
  });

  it('a booking missing its service: the services as chips, even after another lookup', async () => {
    const out = await setup([
      {
        tool: 'create_appointments',
        status: 'error',
        error_code: 'missing_detail',
        result: {
          choice: {
            label: 'Service',
            options: ['Eye checkup', 'LASIK consultation'],
          },
        },
      },
      {
        tool: 'find_services',
        status: 'ok',
        error_code: null,
        result: { passages: [] },
      },
    ]).parts.partsFor(input());
    expect(out.choices).toMatchObject({
      list: 'Service',
      options: [{ label: 'Eye checkup' }, { label: 'LASIK consultation' }],
    });
  });

  it('after an answer: up to 3 starter questions not asked yet', async () => {
    const out = await setup([]).parts.partsFor(
      input({
        runId: null,
        starters: [
          'Is the helpline open now?',
          'Talk to a counsellor',
          'Is it free?',
          'Which languages?',
        ],
        asked: ['is the helpline open now'],
      }),
    );
    expect(out.suggestions?.map((s) => s.label)).toEqual([
      'Talk to a counsellor',
      'Is it free?',
      'Which languages?',
    ]);
  });

  it('a crisis, blocked or fixed reply carries nothing', async () => {
    const out = await setup(
      [
        {
          tool: 'create_registrations',
          status: 'error',
          error_code: 'needs_confirmation',
          result: {},
        },
      ],
      offer(),
    ).parts.partsFor(input({ suppressed: true, starters: ['Is it free?'] }));
    expect(out).toEqual({});
  });

  it('Try it marks its cards "Test only, not saved"', async () => {
    const out = await setup(
      [
        {
          tool: 'create_registrations',
          status: 'error',
          error_code: 'needs_confirmation',
          result: {},
        },
      ],
      offer(),
    ).parts.partsFor(input({ conversationId: 'preview-1' }));
    expect(out.offer?.testOnly).toBe('Test only, not saved');
  });

  it('an entry card never shows the id line', () => {
    expect(
      entryCard('Services', {
        record_title: 'Ration card',
        text: 'id: x\nDocuments: Aadhaar',
      }).details,
    ).toEqual([{ label: 'Documents', value: 'Aadhaar' }]);
  });
});

describe('a refusal said plainly (BT1)', () => {
  it('shows a sentence a person can read, never a code, a key or a line for the agent', () => {
    expect(plainReason('Sun 29 Nov drive is full.')).toBe(
      'Sun 29 Nov drive is full.',
    );
    expect(plainReason('capacity_full')).toBeNull();
    expect(plainReason("Status can't go from booked to no_show.")).toBeNull();
    expect(
      plainReason('Not done yet: ask which service this is for (A, B).'),
    ).toBeNull();
    expect(plainReason('')).toBeNull();
  });
});

describe('a chip tapped after earlier answers keeps them (BT1, 91Springboard)', () => {
  // Tara gave her name and picked Sat 28 Nov, 10:00; the booking waited for its service.
  const waiting = {
    tool: 'create_appointments',
    input: { slot: 'slot-sat-10', person_name: 'Tara Test' },
    status: 'error',
    error_code: 'missing_detail',
    result: {
      field: 'service',
      choice: { label: 'Service', options: ['Day pass', 'Virtual office'] },
    },
  };

  it('the service chip carries the waiting booking with the service filled in', async () => {
    const r = redis();
    const tokens = new ActionTokenService(appConfig(), r as never);
    const parts = new ActionPartsService(
      { query: jest.fn(async () => [waiting]) } as never,
      tokens,
      {} as never,
      { current: jest.fn() } as never,
    );
    const out = await parts.partsFor({
      ...where,
      runId: 'run-1',
      language: 'en',
      suppressed: false,
      answered: false,
    });
    const chip = out.choices!.options[0];
    expect(chip.label).toBe('Day pass');
    expect(await tokens.redeem(chip.token, where)).toMatchObject({
      ok: true,
      claims: {
        kind: 'choose',
        fill: {
          tool: 'create_appointments',
          input: {
            slot: 'slot-sat-10',
            person_name: 'Tara Test',
            service: 'Day pass',
          },
        },
      },
    });
  });

  it('tapping it proposes that booking in code: the card next, never "which city?"', async () => {
    const gateway = {
      proposeWrite: jest.fn().mockResolvedValue({
        ok: false,
        error: 'needs_confirmation',
        replayed: false,
        runId: 'run-proposed',
        result: {
          question:
            'Shall I book Day pass on Sat 28 Nov 2026, 10:00 for Tara Test?',
        },
      }),
    };
    const service = new ActionsService(
      gateway as never,
      {} as never,
      {} as never,
    );
    const decision = await service.perform({
      chatbot: { id: BOT_A },
      conversationId: CONV_A,
      contactId: CONTACT,
      text: 'Day pass',
      tap: {
        ok: true,
        firstUse: true,
        claims: {
          kind: 'choose',
          text: 'Day pass',
          ...where,
          fill: {
            tool: 'create_appointments',
            input: {
              slot: 'slot-sat-10',
              person_name: 'Tara Test',
              service: 'Day pass',
            },
          },
        },
      },
    } as never);
    expect(gateway.proposeWrite).toHaveBeenCalledWith(
      where,
      'create_appointments',
      { slot: 'slot-sat-10', person_name: 'Tara Test', service: 'Day pass' },
    );
    expect(decision).toMatchObject({
      handledBy: WaHandledBy.TAP,
      body: 'Shall I book Day pass on Sat 28 Nov 2026, 10:00 for Tara Test?',
      agent: { runId: 'run-proposed' },
    });
  });

  it('the gateway proposes without writing: no consent on the run', async () => {
    const tool = new RecordingTool('note_it');
    tool.outcome = {
      ok: false,
      error: 'needs_confirmation',
      result: { question: 'Shall I?' },
    };
    const { gateway, db } = makeGateway([tool]);
    db.bots.set(BOT_A, { abilities: { note_it: 'do_it' } as never });
    const out = await gateway.proposeWrite(where, 'note_it', { note: 'x' });
    expect(out).toMatchObject({ ok: false, error: 'needs_confirmation' });
    expect(tool.calls[0].ctx.consentOfferId).toBeNull();
  });
});
