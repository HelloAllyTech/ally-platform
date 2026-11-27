import { stripRecommendedMark } from '../course-copilot-option-label.util';

describe('stripRecommendedMark', () => {
  it.each([
    ['Peer supporters (recommended)', 'Peer supporters'],
    ['Peer supporters (Recommended)', 'Peer supporters'],
    ['Peer supporters [recommended]', 'Peer supporters'],
    ['Peer supporters — recommended', 'Peer supporters'],
    ['Peer supporters - Recommended.', 'Peer supporters'],
    ['(Recommended) Peer supporters', 'Peer supporters'],
    ['Recommended: Peer supporters', 'Peer supporters'],
  ])('takes the mark off %s', (raw, label) => {
    expect(stripRecommendedMark(raw)).toEqual({ label, marked: true });
  });

  it('leaves other labels alone', () => {
    expect(stripRecommendedMark('Recommended reading first')).toEqual({
      label: 'Recommended reading first',
      marked: false,
    });
    expect(stripRecommendedMark('  Quiz  ')).toEqual({
      label: 'Quiz',
      marked: false,
    });
  });

  it('never empties a label that is only the mark', () => {
    expect(stripRecommendedMark('(recommended)')).toEqual({
      label: '(recommended)',
      marked: false,
    });
  });
});
