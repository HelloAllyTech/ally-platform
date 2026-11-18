import { keywordScreen } from '../constants/image-safety.constants';

describe('keywordScreen', () => {
  it.each([
    'A teenager in a school corridor, worried about a friend who talked about suicide',
    'Two counsellors discuss a case of domestic abuse over coffee',
    'A woman alone at night, head in her hands, after a hard day',
    'A helpline volunteer listening on a headset',
  ])('allows a training subject: %s', (text) => {
    expect(keywordScreen(text).ok).toBe(true);
  });

  it.each([
    'A man with a noose in his room',
    'Close-up of her cutting her wrists',
    'He is holding a gun to his head',
    'She swallows a handful of pills',
    'A boy standing on the ledge of a building',
    'Blood on the bathroom floor',
  ])('blocks a depiction of method or injury: %s', (text) => {
    const result = keywordScreen(text);
    expect(result.ok).toBe(false);
    expect(result.suggestion).toMatch(/emotion and body language/);
  });

  it('blocks what looks like a real person’s contact details', () => {
    const result = keywordScreen(
      'Priya, call her on 9876543210 about the case',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/personal details/);
  });
});
