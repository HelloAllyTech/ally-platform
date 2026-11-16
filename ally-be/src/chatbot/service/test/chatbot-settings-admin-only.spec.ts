import { changesAdminOnlySetting } from '../chatbot-settings.service';

describe('changesAdminOnlySetting ("Show typing" is for platform admins)', () => {
  it.each([
    [{}, { showTyping: false }, true],
    [{ showTyping: false }, {}, true],
    [{ showTyping: false }, { showTyping: true }, true],
    [{ showTyping: false }, { showTyping: false, declineText: 'x' }, false],
    [{}, { declineText: 'x' }, false],
    [null, {}, false],
  ])('stored %j → sent %j: %s', (stored, sent, changes) => {
    expect(changesAdminOnlySetting(stored, sent)).toBe(changes);
  });
});

describe('changesAdminOnlySetting (what the agent may do is for platform admins, chunk 3b)', () => {
  const on = { abilities: { hand_over: 'do_it' as const } };
  it.each([
    [{}, on, true],
    [on, {}, true],
    [on, { abilities: { hand_over: 'never' as const } }, true],
    [on, { ...on, declineText: 'x' }, false],
    [
      { abilities: { a: 'do_it' as const, b: 'never' as const } },
      { abilities: { b: 'never' as const, a: 'do_it' as const } },
      false,
    ],
    [{ abilities: {} }, {}, false],
  ])('stored %j → sent %j: %s', (stored, sent, changes) => {
    expect(changesAdminOnlySetting(stored, sent)).toBe(changes);
  });
});
