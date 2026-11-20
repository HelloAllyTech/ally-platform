import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { TrackGameKey } from 'src/track/type/game.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  DEFAULT_BREATHING_EXERCISE,
  matchTriggerWarnings,
} from '../item-defaults.util';

const warnings = [
  { id: 'tw-suicide', name: 'Suicidal ideation' },
  { id: 'tw-self-harm', name: 'Self-harm' },
  { id: 'tw-grief', name: 'Grief and bereavement' },
];

describe('matchTriggerWarnings', () => {
  it('keeps real ids', () => {
    expect(matchTriggerWarnings(['tw-grief'], warnings)).toEqual(['tw-grief']);
  });

  it('maps an invented label to every warning it names', () => {
    expect(
      matchTriggerWarnings(['suicidal-ideation-self-harm'], warnings),
    ).toEqual(['tw-suicide', 'tw-self-harm']);
  });

  it('maps a plain name, whatever its case and spacing', () => {
    expect(matchTriggerWarnings(['Grief and Bereavement'], warnings)).toEqual([
      'tw-grief',
    ]);
  });

  it('drops what it cannot match, and duplicates', () => {
    expect(
      matchTriggerWarnings(
        ['violence', '', 'Self-harm', 'self harm'],
        warnings,
      ),
    ).toEqual(['tw-self-harm']);
  });
});

describe('DEFAULT_BREATHING_EXERCISE', () => {
  it('is a breathing configuration the course validator accepts', () => {
    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.GAME,
        content: {
          gameKey: TrackGameKey.BREATHING_EXERCISE,
          breathingExercise: DEFAULT_BREATHING_EXERCISE,
        },
        title: 'Breathing break',
      }),
    ).not.toThrow();
  });
});
