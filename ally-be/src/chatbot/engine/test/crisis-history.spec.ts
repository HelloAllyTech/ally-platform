import {
  crisisHistory,
  crisisRequest,
  MAX_CRISIS_HISTORY_CHARS,
} from '../crisis-history';

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

/** Chunk 15a: what the crisis check sees of the person's earlier messages. */
describe('crisisHistory', () => {
  it("drops the current message where the channel's history ends with it", () => {
    // WhatsApp and the bot page store the message before answering.
    expect(
      crisisHistory({
        text: 'I mean it',
        history: [
          user('I saved up my pills'),
          assistant('…'),
          user('I mean it'),
        ],
      }),
    ).toEqual(['I saved up my pills']);
  });

  it("keeps everything where it doesn't (Preview)", () => {
    expect(
      crisisHistory({
        text: 'and what if I miss a day?',
        history: [user('how do streaks work?'), assistant('A streak counts…')],
      }),
    ).toEqual(['how do streaks work?']);
  });

  it("never sends the assistant's replies", () => {
    expect(
      crisisHistory({
        text: 'ok',
        history: [assistant('Please call 14416'), user('hi'), assistant('Hi!')],
      }),
    ).toEqual(['hi']);
  });

  it('keeps the newest five, newest last, without blanks', () => {
    const history = ['1', '2', ' ', '3', '4', '5', '6', '7'].map(user);
    expect(crisisHistory({ text: 'now', history })).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });

  it('keeps 1,500 characters, newest first: the message crossing it keeps its end', () => {
    const kept = crisisHistory({
      text: 'now',
      history: [
        user('o'.repeat(1000)),
        user('m'.repeat(1200)),
        user('n'.repeat(400)),
      ],
    });
    expect(kept).toHaveLength(2);
    expect(kept[1]).toBe('n'.repeat(400));
    expect(kept[0].startsWith('…m')).toBe(true);
    expect(kept.join('').length).toBe(MAX_CRISIS_HISTORY_CHARS);
  });

  it('is empty for a first message', () => {
    expect(crisisHistory({ text: 'hi', history: [user('hi')] })).toEqual([]);
    expect(crisisHistory({ text: 'hi', history: [] })).toEqual([]);
  });
});

describe('crisisRequest', () => {
  it("is exactly the old request when there's no earlier message", () => {
    expect(crisisRequest({ text: 'hi', history: [] }, { p: 1 })).toEqual({
      message: 'hi',
      prompts: { p: 1 },
    });
  });

  it('carries the earlier messages when there are some', () => {
    expect(
      crisisRequest({ text: 'yes', history: [user('a'), user('yes')] }, {}),
    ).toEqual({ message: 'yes', history: ['a'], prompts: {} });
  });
});
