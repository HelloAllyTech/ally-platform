import { renderDebrief, resolveMomentAnchors } from '../debrief-render.util';

const turns = new Map<number, number>([
  [101, 3],
  [104, 7],
]);

describe('renderDebrief', () => {
  it('prefers the supervisor note, which is what the apps render', () => {
    const r = renderDebrief(
      {
        supervisorNote: 'You reflected well [[msg:101]].',
        positives: ['ignored'],
      },
      turns,
    );
    expect(r).toEqual({
      text: 'You reflected well (turn 3).',
      source: 'supervisor_note',
    });
  });

  it('reads snake_case notes too', () => {
    const r = renderDebrief({ supervisor_note: 'Note [[msg:104]]' }, turns);
    expect(r?.text).toBe('Note (turn 7)');
  });

  it('falls back to the lists for older debriefs', () => {
    const r = renderDebrief(
      {
        positives: ['Warm opening', '  '],
        areasOfGrowth: [
          {
            improvement: 'Advice came early.',
            recommendation: 'Reflect first.',
          },
        ],
      },
      turns,
    );
    expect(r).toEqual({
      text:
        'What worked:\n- Warm opening\n\nAreas to grow:\n' +
        '- Advice came early. Reflect first.',
      source: 'lists',
    });
  });

  it('uses the old improvements list when there are no areas of growth', () => {
    const r = renderDebrief({ improvements: ['Slow down.'] }, turns);
    expect(r?.text).toBe('Areas to grow:\n- Slow down.');
  });

  it('returns null when there is nothing to score', () => {
    expect(renderDebrief(null, turns)).toBeNull();
    expect(
      renderDebrief({ supervisorNote: '   ', positives: [] }, turns),
    ).toBeNull();
  });
});

describe('resolveMomentAnchors', () => {
  it('drops an anchor to a message the transcript does not hold', () => {
    expect(resolveMomentAnchors('A [[msg:999]] B', turns)).toBe('A  B');
  });
});
