import { ListFieldType } from '../../enum/list.enum';
import { ListToolsService } from '../list-tools.service';

/**
 * TF1 F1: a callback on WhatsApp asked for the number the person was messaging from, and "my
 * number is this one" was refused as a missing detail.
 */
describe('a phone detail on WhatsApp', () => {
  const list = {
    fields: [
      {
        key: 'name',
        type: ListFieldType.TEXT,
        agent_write: true,
        archived_at: null,
      },
      {
        key: 'phone',
        type: ListFieldType.PHONE,
        agent_write: true,
        archived_at: null,
      },
    ],
  };
  const service = (identity: string | null) => {
    const query = jest.fn(async (sql: string) =>
      sql.includes("channel = 'whatsapp'")
        ? identity
          ? [{ external_id: identity }]
          : []
        : [],
    );
    return new ListToolsService(
      { query } as never,
      {} as never,
      {} as never,
    ) as unknown as {
      fillFromIntake: (
        ctx: unknown,
        list: unknown,
        data: Record<string, unknown>,
        name: unknown,
      ) => Promise<void>;
    };
  };
  const ctx = { chatbotId: 'bot-1', contactId: 'contact-1' };

  it('takes the number they write from when none is given', async () => {
    const data: Record<string, unknown> = { name: 'Bilal' };
    await service('919800000001').fillFromIntake(ctx, list, data, 'Bilal');
    expect(data.phone).toBe('+919800000001');
  });

  it('"this one" is not a number: the WhatsApp number replaces it', async () => {
    const data: Record<string, unknown> = { phone: 'this one' };
    await service('919800000001').fillFromIntake(ctx, list, data, null);
    expect(data.phone).toBe('+919800000001');
  });

  it('a different number they give is kept', async () => {
    const data: Record<string, unknown> = { phone: '+91 98765 43210' };
    await service('919800000001').fillFromIntake(ctx, list, data, null);
    expect(data.phone).toBe('+91 98765 43210');
  });

  it('on the web, with no WhatsApp number, it stays empty (the assistant asks)', async () => {
    const data: Record<string, unknown> = {};
    await service(null).fillFromIntake(ctx, list, data, null);
    expect(data.phone).toBeUndefined();
  });
});
