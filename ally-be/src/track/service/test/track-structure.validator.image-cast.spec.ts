import { BadRequestException } from '@nestjs/common';
import { validateTrackStructure } from '../track-structure.validator';
import { TrackItemType } from '../../type/track.type';
import { BranchingScenarioContent } from '../../type/branching.type';
import { UpsertTrackSectionDto } from '../../dto/upsert-track-structure.dto';

const scenario = (imageCast?: unknown): BranchingScenarioContent =>
  ({
    startNodeId: 'start',
    nodes: [
      {
        id: 'start',
        text: 'A caller hesitates.',
        choices: [{ id: 'c', text: 'Wait', nextNodeId: 'end' }],
      },
      { id: 'end', text: 'She speaks.', outcome: 'POSITIVE' },
    ],
    ...(imageCast === undefined ? {} : { imageCast }),
  }) as any;

const wrap = (content: unknown): UpsertTrackSectionDto[] => [
  {
    title: 'S',
    order: 1,
    items: [
      {
        type: TrackItemType.BRANCHING_SCENARIO,
        order: 1,
        title: 'Call',
        content: content as any,
      },
    ],
  },
];

describe('validateTrackStructure - branching image cast (Image Studio)', () => {
  it('accepts a story without a cast, as before', () => {
    expect(() => validateTrackStructure(wrap(scenario()))).not.toThrow();
  });

  it('accepts a cast of characters with ids and names', () => {
    expect(() =>
      validateTrackStructure(
        wrap(
          scenario([
            {
              characterId: '0f8fad5b-d9cb-469f-a165-70867728950e',
              name: 'Ravi',
            },
          ]),
        ),
      ),
    ).not.toThrow();
  });

  it.each([
    ['not a list', 'Ravi'],
    ['a member without an id', [{ name: 'Ravi' }]],
    [
      'too many members',
      Array.from({ length: 7 }, (_, i) => ({
        characterId: `c${i}`,
        name: `P${i}`,
      })),
    ],
  ])('rejects %s', (_label, imageCast) => {
    expect(() => validateTrackStructure(wrap(scenario(imageCast)))).toThrow(
      BadRequestException,
    );
  });
});
