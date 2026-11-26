import { recordedWebhook } from '../../test/fixtures/recorded';
import { parseWhatsAppStatuses, WaStatusService } from '../wa-status.service';

const sent = recordedWebhook('status-sent');
const delivered = recordedWebhook('status-delivered');
const read = recordedWebhook('status-read');
const failed = recordedWebhook('status-failed');
const inboundText = recordedWebhook('voice-note-hi');

const ID = 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSOUFCQ0RFRjAxMjM0NTY3OAA=';

describe('WhatsApp delivery status (WA-A §3)', () => {
  describe('parseWhatsAppStatuses (recorded webhooks)', () => {
    it.each([
      ['sent', sent],
      ['delivered', delivered],
      ['read', read],
    ])('reads %s with its time and recipient', (status, body) => {
      const [update] = parseWhatsAppStatuses(body);
      expect(update).toMatchObject({
        providerMessageId: ID,
        status,
        recipient: '919876543210',
        errorCode: null,
      });
      expect(update.at).toBeInstanceOf(Date);
    });

    it("reads a failure with Meta's code, title and detail", () => {
      const [update] = parseWhatsAppStatuses(failed);
      expect(update).toMatchObject({
        status: 'failed',
        errorCode: 131047,
        errorTitle: 'Re-engagement message',
      });
      expect(update.errorDetail).toContain('24 hours');
    });

    it('finds nothing in an incoming message, or in junk', () => {
      expect(parseWhatsAppStatuses(inboundText)).toEqual([]);
      expect(parseWhatsAppStatuses(null)).toEqual([]);
      expect(parseWhatsAppStatuses({ entry: [{ changes: [{}] }] })).toEqual([]);
    });
  });

  describe('WaStatusService.record', () => {
    const harness = (
      returning: unknown = [
        [{ conversation_id: 'conv-1', chatbot_id: 'bot-1' }],
        1,
      ],
    ) => {
      const query = jest
        .fn()
        .mockImplementation((sql: string) =>
          Promise.resolve(sql.includes('RETURNING') ? returning : []),
        );
      const events = { publishInbox: jest.fn().mockResolvedValue(undefined) };
      const service = new WaStatusService({ query } as never, events as never);
      return { service, query, events };
    };

    it('stores the status by Meta id, mirrors it onto the messages and tells the Inbox', async () => {
      const h = harness();
      expect(await h.service.record(delivered)).toBe(1);
      const [insert, waMessages, chatbotMessages] = h.query.mock.calls;
      expect(insert[0]).toContain('INSERT INTO wa_message_statuses');
      expect(insert[1].slice(0, 4)).toEqual([
        ID,
        'delivered',
        '919876543210',
        2,
      ]);
      expect(waMessages[0]).toContain('UPDATE wa_messages');
      expect(chatbotMessages[0]).toContain('UPDATE chatbot_messages');
      expect(h.events.publishInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          chatbotId: 'bot-1',
          conversationId: 'conv-1',
          status: 'delivered',
        }),
      );
    });

    it('only moves forward: the upsert never takes a status back, and a failure keeps its reason', async () => {
      const h = harness();
      await h.service.record(failed);
      const [insert, waMessages] = h.query.mock.calls;
      expect(insert[0]).toContain("WHEN s.status = 'failed' THEN s.status");
      expect(insert[1][5]).toBe(true);
      expect(waMessages[1][2]).toBe('131047 Re-engagement message');
    });

    it('a status for a message no conversation knows (a campaign send) is still stored, quietly', async () => {
      const h = harness([[], 0]);
      expect(await h.service.record(read)).toBe(1);
      expect(h.events.publishInbox).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      const h = harness();
      h.query.mockRejectedValue(new Error('db down'));
      await expect(h.service.record(sent)).resolves.toBe(0);
    });
  });
});
