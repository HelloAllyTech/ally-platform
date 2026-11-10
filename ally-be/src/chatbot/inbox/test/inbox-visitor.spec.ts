import { ConversationChannel } from '../../enum/conversation.enum';
import { inboxVisitor, visitorTag } from '../inbox.service';

describe('Who the visitor is in the inbox (chunk 20d-2)', () => {
  it('uses the name they gave before the chat', () => {
    expect(
      inboxVisitor({
        id: 'c1',
        channel: ConversationChannel.WEB,
        intake: {
          answers: [{ type: 'text', label: 'Your name', value: ' Asha ' }],
        },
      }),
    ).toBe('Asha');
  });

  it("otherwise a WhatsApp number's last 4", () => {
    expect(
      inboxVisitor({
        id: 'c2',
        channel: ConversationChannel.WHATSAPP,
        external_id: '919820013210',
      }),
    ).toBe('Visitor · 3210');
  });

  it('otherwise 4 digits from the conversation, the same every time', () => {
    const row = {
      id: '00000000-0000-4000-8000-0000000000c1',
      channel: ConversationChannel.WEB,
    };
    expect(inboxVisitor(row)).toMatch(/^Visitor · \d{4}$/);
    expect(inboxVisitor(row)).toBe(inboxVisitor({ ...row }));
    expect(visitorTag('a')).not.toBe(visitorTag('b'));
  });
});
