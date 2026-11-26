import { MemoryService } from '../memory.service';

const CONTACT = '7a9c1a52-2222-4a8e-9a0c-1b2c3d4e5f61';
const chatbot = { id: 'bot-1', settings: {}, safetyPack: null } as never;

/**
 * TF1 round 2 (Saathi B-2): "Hi, I'm Asha", then "What's my name?" in a new chat: "I don't know
 * your name". The name is saved before the reply, memory on or off, and only from this message.
 */
describe('the name, saved before the reply', () => {
  const setup = (updated = true) => {
    const query = jest.fn().mockResolvedValue(updated ? [{ id: CONTACT }] : []);
    const memory = new MemoryService(
      { query } as never,
      {} as never,
      { get: async () => ({}) } as never,
    );
    return { memory, query };
  };
  const nameOp = (text: string) => ({
    writes: [{ op: 'name' as const, text }],
    refs: {},
  });

  it("the run's name op, when the name is in this message", async () => {
    const { memory, query } = setup();
    expect(
      await memory.nameNow({
        chatbot,
        contactId: CONTACT,
        pending: nameOp('Asha'),
        text: "Hi, I'm Asha",
      }),
    ).toBe('Asha');
    expect(query.mock.calls[0][0]).toContain('name_forgotten_at = NULL');
    expect(query.mock.calls[0][0]).toContain('display_name IS NULL');
  });

  it('a name stated outright, with no op from the model', async () => {
    const { memory } = setup();
    expect(
      await memory.nameNow({
        chatbot,
        contactId: CONTACT,
        text: 'mera naam Asha hai',
      }),
    ).toBe('Asha');
  });

  it.each([
    'Can someone call me back tomorrow evening?',
    "I'm stressed",
    "I'm 16",
  ])('nothing to save: %s', async (text) => {
    const { memory, query } = setup();
    expect(
      await memory.nameNow({ chatbot, contactId: CONTACT, text }),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('a name op from an earlier message is not taken again in this one', async () => {
    const { memory, query } = setup();
    expect(
      await memory.nameNow({
        chatbot,
        contactId: CONTACT,
        pending: nameOp('Asha'),
        text: 'What are your hours?',
      }),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('a person who already has a name keeps it (no notice)', async () => {
    const { memory } = setup(false);
    expect(
      await memory.nameNow({
        chatbot,
        contactId: CONTACT,
        text: 'my name is Asha',
      }),
    ).toBeNull();
  });

  it('WA-A §0b: a name given in the chat replaces a WhatsApp profile name, and is marked as given', async () => {
    const { memory, query } = setup();
    expect(
      await memory.nameNow({ chatbot, contactId: CONTACT, text: "I'm Bilal" }),
    ).toBe('Bilal');
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("OR display_name_source = 'whatsapp_profile'");
    expect(sql).toContain("display_name_source = 'chat'");
  });

  it('forget my name clears it and marks it forgotten', async () => {
    const { memory, query } = setup();
    expect(await memory.forgetName('bot-1', CONTACT)).toBe(true);
    expect(query.mock.calls[0][0]).toContain('display_name = NULL');
    expect(query.mock.calls[0][0]).toContain('name_forgotten_at = now()');
  });
});
