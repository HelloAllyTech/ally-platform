import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { ListFieldType } from '../../enum/list.enum';
import type { ListDefinitionView } from '../../lists/list-definitions.service';
import type { ListRecordView } from '../../lists/list-types';
import { AgentRunTokenService } from '../agent-run-token.service';
import {
  isPlainYes,
  namesEntry,
  offerFor,
  questionIn,
  questionShown,
} from '../list-consent';
import { ListConsentService } from '../list-consent.service';
import { memoryRedis } from './agent-tools.fakes';

describe('consent for list writes (chunk H1)', () => {
  describe('isPlainYes', () => {
    it.each([
      'Yes.',
      'Yes, book it.',
      'yes please',
      'Yes, move it.',
      'OK go ahead',
      'Sure, do it',
      'haan kar do',
      'theek hai',
      'हाँ, बुक कर दीजिए',
      'जी हाँ',
      'Yes, I am sure',
    ])('%s is a yes', (text) => expect(isPlainYes(text)).toBe(true));

    it.each([
      'OK, 1pm then for the LASIK consultation.',
      'Please also book a LASIK consultation for me on Thursday at 11.',
      '11 works for me. I’m Priya Test.',
      'Yes but make it 3pm',
      'yes, and also a cataract consultation',
      'No',
      'not now',
      'ok?',
      'Can you book it?',
      'nahi',
      'ok instead the other one',
      'Yes please, go ahead and book it for me right now thanks',
      '',
    ])('%s is not', (text) => expect(isPlainYes(text)).toBe(false));
  });

  const list = {
    key: 'appointments',
    name: 'Appointments',
    settings: { title_field: 'slot', person_field: 'client' },
    fields: [
      {
        key: 'slot',
        label: 'Slot',
        type: ListFieldType.RELATION,
        options: { to: 'slots' },
      },
      {
        key: 'client',
        label: 'Client',
        type: ListFieldType.RELATION,
        options: { to: 'contact' },
      },
      { key: 'service', label: 'Service', type: ListFieldType.SELECT },
      { key: 'status', label: 'Status', type: ListFieldType.SELECT },
    ],
  } as unknown as ListDefinitionView;
  const record = (
    id: string,
    title: string,
    service: string,
    status = 'booked',
  ) =>
    ({
      id,
      title,
      display: { slot: title, client: 'Priya Test', service, status },
    }) as unknown as ListRecordView;

  it('a booking names the service, the day and time, and the person', () => {
    const offer = offerFor(
      list,
      'create',
      record('new', 'Sat 21 Nov 2026, 13:00', 'LASIK consultation'),
      null,
      true,
    );
    expect(offer.questions.en).toBe(
      'Shall I book LASIK consultation on Sat 21 Nov 2026, 13:00 for Priya Test?',
    );
    expect(offer.questions.hi).toContain('Sat 21 Nov 2026, 13:00');
  });

  it('a booking for someone else says their name back (Q4 B13)', () => {
    const offer = offerFor(
      list,
      'create',
      record('new', 'Sat 21 Nov 2026, 13:00', 'Eye checkup'),
      null,
      true,
      {},
      'Lakshmi Rao',
    );
    expect(offer.questions.en).toBe(
      'Shall I book Eye checkup on Sat 21 Nov 2026, 13:00 for Lakshmi Rao?',
    );
  });

  it('a move names the entry it moves; a cancel says cancel', () => {
    const before = record('a', 'Sat 21 Nov 2026, 11:00', 'Eye checkup');
    const moved = offerFor(
      list,
      'update',
      record('a', 'Sat 21 Nov 2026, 13:00', 'LASIK consultation'),
      before,
      false,
    );
    expect(moved.questions.en).toBe(
      'Shall I change your Eye checkup on Sat 21 Nov 2026, 11:00 to LASIK consultation on Sat 21 Nov 2026, 13:00?',
    );
    const cancel = offerFor(
      list,
      'update',
      record('a', 'Sat 21 Nov 2026, 11:00', 'Eye checkup', 'cancelled'),
      before,
      false,
    );
    expect(cancel.questions.en).toBe(
      'Shall I cancel your Eye checkup on Sat 21 Nov 2026, 11:00?',
    );
  });

  it('the same entry gives the same key; another gives another', () => {
    const a = offerFor(
      list,
      'create',
      record('x', 'Sat 21 Nov 2026, 13:00', 'Eye checkup'),
      null,
      true,
    );
    const again = offerFor(
      list,
      'create',
      record('y', 'Sat 21 Nov 2026, 13:00', 'Eye checkup'),
      null,
      true,
    );
    const other = offerFor(
      list,
      'create',
      record('z', 'Sat 21 Nov 2026, 14:00', 'Eye checkup'),
      null,
      true,
    );
    expect(again.key).toBe(a.key);
    expect(other.key).not.toBe(a.key);
  });

  it('finds the question in the message that carried it, in either language', () => {
    const q = {
      en: 'Shall I book Eye checkup on Sat 21 Nov 2026, 11:00 for Priya Test?',
      hi: 'क्या मैं …?',
    };
    expect(questionShown(`Sure. ${q.en}`, q)).toBe(true);
    expect(questionShown('Shall I book it?', q)).toBe(false);
    expect(questionIn(q, 'hi')).toBe(q.hi);
    expect(questionIn(q, 'en')).toBe(q.en);
  });

  it('a model-written question names the entry when it gives its date, time and service', () => {
    const entry = record('x', 'Thu 26 Nov 2026, 13:00', 'LASIK consultation');
    expect(
      namesEntry(
        'Shall I book Thursday 26 Nov 2026 at 1:00 PM for a LASIK consultation?',
        list,
        entry,
      ),
    ).toBe(true);
    expect(
      namesEntry(
        'Shall I book 26 Nov at 13:00, LASIK consultation?',
        list,
        entry,
      ),
    ).toBe(true);
    // Another time, another day or another service is not this entry.
    expect(
      namesEntry(
        'Shall I book 26 Nov at 11:00, LASIK consultation?',
        list,
        entry,
      ),
    ).toBe(false);
    expect(
      namesEntry(
        'Shall I book 27 Nov at 13:00, LASIK consultation?',
        list,
        entry,
      ),
    ).toBe(false);
    expect(
      namesEntry('Shall I book 26 Nov at 13:00, Eye checkup?', list, entry),
    ).toBe(false);
  });

  it('a nameless contact is never said back, and the key ignores the person', () => {
    const nameless = {
      ...record('x', 'Sat 21 Nov 2026, 13:00', 'Eye checkup'),
      display: {
        slot: 'Sat 21 Nov 2026, 13:00',
        client: 'A contact',
        service: 'Eye checkup',
        status: 'booked',
      },
    } as unknown as ListRecordView;
    const named = record('y', 'Sat 21 Nov 2026, 13:00', 'Eye checkup');
    const a = offerFor(list, 'create', nameless, null, true);
    expect(a.questions.en).toBe(
      'Shall I book Eye checkup on Sat 21 Nov 2026, 13:00?',
    );
    expect(offerFor(list, 'create', named, null, true).key).toBe(a.key);
  });

  describe('ListConsentService', () => {
    const ctx = { chatbotId: 'bot', conversationId: 'conv', runId: 'run-1' };
    const q = {
      en: 'Shall I book Eye checkup on Sat 21 Nov 2026, 11:00 for Priya Test?',
      hi: 'क्या?',
    };

    it('gives the turn the offer only for a plain yes to the message that asked it', async () => {
      const consent = new ListConsentService(memoryRedis() as never);
      const offer = await consent.offer(
        ctx,
        'create_appointments',
        'k',
        'Appointments',
        q,
      );
      expect(
        await consent.consentFor('bot', 'conv', 'Yes, book it.', q.en),
      ).toBe(offer.id);
      expect(
        await consent.consentFor(
          'bot',
          'conv',
          'OK, 1pm then for the LASIK consultation.',
          q.en,
        ),
      ).toBeNull();
      expect(
        await consent.consentFor('bot', 'conv', 'Yes', 'Which time suits you?'),
      ).toBeNull();
    });

    it('accepts only the same tool and entry, from a later run, once', async () => {
      const consent = new ListConsentService(memoryRedis() as never);
      const offer = await consent.offer(
        ctx,
        'create_appointments',
        'k',
        'Appointments',
        q,
      );
      const later = { ...ctx, runId: 'run-2', consentOfferId: offer.id };
      expect(
        await consent.accepts(
          { ...ctx, consentOfferId: offer.id },
          'create_appointments',
          'k',
        ),
      ).toBeNull();
      expect(
        await consent.accepts(later, 'update_appointments', 'k'),
      ).toBeNull();
      expect(
        await consent.accepts(later, 'create_appointments', 'other'),
      ).toBeNull();
      expect(
        await consent.accepts(later, 'create_appointments', 'k'),
      ).not.toBeNull();
      await consent.consume('bot', 'conv');
      expect(
        await consent.accepts(later, 'create_appointments', 'k'),
      ).toBeNull();
    });

    it('a plain yes to a message naming the entry is accepted without a stored offer', async () => {
      const consent = new ListConsentService(memoryRedis() as never);
      await consent.rememberTurn(
        'run-9',
        'Yes, book it.',
        'Shall I book it at 10:00?',
      );
      const later = { ...ctx, runId: 'run-9' };
      expect(
        await consent.accepts(later, 'create_appointments', 'k', () => true),
      ).not.toBeNull();
      expect(
        await consent.accepts(later, 'create_appointments', 'k', () => false),
      ).toBeNull();
      await consent.rememberTurn(
        'run-10',
        'OK, 1pm then',
        'Shall I book it at 10:00?',
      );
      expect(
        await consent.accepts(
          { ...ctx, runId: 'run-10' },
          'create_appointments',
          'k',
          () => true,
        ),
      ).toBeNull();
    });

    it('fails closed when Redis fails', async () => {
      const redis = memoryRedis();
      redis.get.mockRejectedValue(new Error('down'));
      const consent = new ListConsentService(redis as never);
      expect(await consent.consentFor('bot', 'conv', 'Yes', q.en)).toBeNull();
      expect(
        await consent.accepts(
          { ...ctx, runId: 'run-2', consentOfferId: 'x' },
          'create_appointments',
          'k',
        ),
      ).toBeNull();
    });
  });

  describe('the run token dies with the run', () => {
    const service = new AgentRunTokenService({
      agentGatewaySecret: 'secret',
      publicApiBaseUrl: 'http://api.test',
      jwt: { accessToken: { secret: 'access' } },
    } as never);
    const claims = {
      chatbotId: 'bot',
      conversationId: 'conv',
      runId: 'run',
      contactId: null,
      tools: ['create_appointments'],
      consent: 'offer-1',
    };

    it('expires at the cap plus a second, and carries the consent', () => {
      const token = service.sign(claims, 45);
      const decoded = jwt.decode(token) as jwt.JwtPayload;
      expect(decoded.exp! - decoded.iat!).toBe(46);
      expect(service.verify(`Bearer ${token}`).consent).toBe('offer-1');
    });

    it('a call after the cap is refused', () => {
      const token = service.sign(claims, 45);
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 47_000);
      try {
        expect(() => service.verify(`Bearer ${token}`)).toThrow(
          UnauthorizedException,
        );
      } finally {
        spy.mockRestore();
      }
    });
  });
});

describe('missingChoice (chunk H1)', () => {
  const { missingChoice } = require('../list-tools.service');
  const list = {
    settings: { person_field: 'client' },
    fields: [
      { key: 'service', label: 'Service', type: 'select' },
      { key: 'status', label: 'Status', type: 'select', default: 'booked' },
    ],
  };
  const def = {
    input_schema: {
      properties: {
        service: { enum: ['', 'Eye checkup', 'LASIK consultation'] },
        status: { enum: ['', 'booked'] },
      },
    },
  };

  it('offers only real options, never the empty "not given"', () => {
    expect(missingChoice(list, def, {})).toEqual({
      key: 'service',
      label: 'Service',
      options: ['Eye checkup', 'LASIK consultation'],
    });
    expect(missingChoice(list, def, { service: 'Eye checkup' })).toBeNull();
  });

  describe('the question and card name the right things (Q4 G5)', () => {
    const registrations = {
      key: 'registrations',
      name: 'Registrations',
      settings: { title_field: 'event', person_field: 'attendee' },
      rules: [{ id: 'r1', kind: 'capacity', config: {} }],
      fields: [
        {
          key: 'event',
          label: 'Event',
          type: ListFieldType.RELATION,
          options: { to: 'events' },
        },
        {
          key: 'attendee',
          label: 'Attendee',
          type: ListFieldType.RELATION,
          options: { to: 'contact' },
        },
        {
          key: 'guests',
          label: 'Guests',
          type: ListFieldType.NUMBER,
          default: 0,
        },
        { key: 'status', label: 'Status', type: ListFieldType.SELECT },
      ],
    } as unknown as ListDefinitionView;
    const registration = (guests: number, attendee = 'Sana Shaikh') =>
      ({
        id: 'reg-1',
        title: 'Bandra Sunday food drive',
        data: { event: 'ev-1', guests },
        display: {
          event: 'Bandra Sunday food drive',
          attendee,
          guests: String(guests),
          status: 'registered',
        },
        contact_id: 'c1',
      }) as unknown as ListRecordView;
    const related = {
      when: 'Sun 29 Nov 2026, 11:00',
      where: 'Bandra West station, skywalk exit',
    };

    it('names the day, time, place and places, never "book 0"', () => {
      const { questions } = offerFor(
        registrations,
        'create',
        registration(0),
        null,
        true,
        related,
      );
      expect(questions.en).toBe(
        'Shall I register Sana Shaikh for Bandra Sunday food drive on Sun 29 Nov 2026, 11:00 at Bandra West station, skywalk exit (1 place)?',
      );
      expect(questions.en).not.toMatch(/\b0\b/);
    });

    it('a yes still counts when only the quantity or name was filled after the question', () => {
      const asked = offerFor(
        registrations,
        'create',
        registration(0),
        null,
        true,
        related,
      );
      const after = offerFor(
        registrations,
        'create',
        registration(1, 'Sana S.'),
        null,
        true,
        related,
      );
      expect(after.key).toBe(asked.key);
    });

    it('the verb follows what the list is for (Q4 G5, approved 23 Nov)', () => {
      const as = (key: string, name: string) => ({
        ...registrations,
        key,
        name,
      });
      const ask = (l: ListDefinitionView, person?: string) =>
        offerFor(l, 'create', registration(0, person), null, true, related)
          .questions;

      const registered = ask(registrations, 'Try it');
      expect(registered.en).toMatch(
        /^Shall I register you for Bandra Sunday food drive/,
      );
      expect(registered.hi).toMatch(
        /^क्या मैं आपको .* के लिए रजिस्टर कर दूँ\?$/,
      );

      const callback = ask(as('callback_requests', 'Callback requests'));
      expect(callback.en).toMatch(
        /^Shall I request a callback for Sana Shaikh about /,
      );
      expect(callback.hi).toMatch(
        /^क्या मैं Sana Shaikh के लिए कॉलबैक का अनुरोध भेज दूँ/,
      );

      const application = ask(as('applications', 'Volunteer applications'));
      expect(application.en).toMatch(
        /^Shall I send your application for .*\(Sana Shaikh\)\?$/,
      );
      expect(application.hi).toMatch(/के लिए आपका आवेदन भेज दूँ/);

      const booking = ask(as('appointments', 'Appointments'));
      expect(booking.en).toMatch(/^Shall I book .* for Sana Shaikh\?$/);
      expect(booking.hi).toMatch(/बुक कर दूँ\?$/);

      const other = offerFor(
        as('enquiries', 'Enquiries'),
        'create',
        registration(0),
        null,
        false,
      ).questions;
      expect(other.en).toMatch(/^Shall I add this to Enquiries: /);
      expect(other.hi).toMatch(/^क्या मैं इसे Enquiries में जोड़ दूँ: /);
    });

    it("never names Try it's test visitor", () => {
      const { questions } = offerFor(
        registrations,
        'create',
        registration(0, 'Try it'),
        null,
        true,
        related,
      );
      expect(questions.en).not.toMatch(/try it/i);
    });
  });
});
