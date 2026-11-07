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
