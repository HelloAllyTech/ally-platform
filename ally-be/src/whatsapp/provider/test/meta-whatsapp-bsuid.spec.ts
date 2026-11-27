import axios from 'axios';
import { countryOf } from '../../../billing/service/whatsapp-pricing.service';
import { recordedWebhook } from '../../test/fixtures/recorded';
import {
  isBusinessScopedId,
  lastFourOf,
  waAddressOf,
} from '../../util/wa-address';
import { MetaWhatsAppProvider } from '../meta-whatsapp.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** WA-A §4 (RC1 §4b): a person known only by Meta's business-scoped user ID. */
describe('business-scoped user IDs (WA-A §4)', () => {
  const provider = new MetaWhatsAppProvider({
    whatsapp: {
      phoneNumberId: '123',
      accessToken: 'token',
      graphApiVersion: 'v25.0',
    },
  } as never);

  it('a webhook with only the business-scoped ID is parsed, never dropped', () => {
    const [message] = provider.parseInbound(
      recordedWebhook('business-scoped-id'),
    );
    expect(message).toMatchObject({
      from: '',
      fromUserId: 'IN.13491208655302741918',
      text: 'What are your opening hours?',
      profileName: 'Meera',
    });
  });

  it('a message with neither a number nor an ID is still dropped', () => {
    const body = recordedWebhook('business-scoped-id');
    delete body.entry[0].changes[0].value.messages[0].from_user_id;
    expect(provider.parseInbound(body)).toEqual([]);
  });

  it('a reply to an ID goes as `recipient`; to a number, as `to`', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { messages: [{ id: 'wamid.out' }] },
    });
    await provider.sendText('IN.13491208655302741918', 'Hello');
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({
      recipient: 'IN.13491208655302741918',
    });
    expect((mockedAxios.post.mock.calls[0][1] as any).to).toBeUndefined();
    await provider.sendText('919876543210', 'Hello');
    expect(mockedAxios.post.mock.calls[1][1]).toMatchObject({
      to: '919876543210',
    });
    expect(
      (mockedAxios.post.mock.calls[1][1] as any).recipient,
    ).toBeUndefined();
  });

  it('helpers: the address, the masked label, the country for pricing', () => {
    expect(isBusinessScopedId('IN.13491208655302741918')).toBe(true);
    expect(isBusinessScopedId('919876543210')).toBe(false);
    expect(waAddressOf({ phoneE164: null, bsuid: 'IN.1' })).toBe('IN.1');
    expect(waAddressOf({ phoneE164: '9198', bsuid: 'IN.1' })).toBe('9198');
    expect(lastFourOf('IN.13491208655302741918')).toBe('1918');
    expect(countryOf('IN.13491208655302741918')).toBe('IN');
    expect(countryOf('919876543210')).toBe('IN');
  });
});
