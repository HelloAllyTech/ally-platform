import {
  GUIDE_CARD_KIND_VALUES,
  GUIDE_CARD_PRESENTATION_VALUES,
  GUIDE_CARD_STATE_VALUES,
  GUIDE_CHANNEL_VALUES,
  GUIDE_MODE_VALUES,
  GUIDE_TONE_VALUES,
} from '../../contract/generated/guide-contract';
import { AgentChannel } from 'src/llm-agent/harness/enum/harness.enum';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
  GuideMode,
  GuideTone,
} from '../guide.enum';

/**
 * Values stored in guide_* columns and sent on the wire must be the same set,
 * or a row could hold a value the client has no rendering for. The contract
 * (generated from the schema) is the reference.
 */
const sorted = (values: readonly string[]) => [...values].sort();

describe('guide enums match the wire contract', () => {
  it.each([
    ['GuideMode', Object.values(GuideMode), GUIDE_MODE_VALUES],
    ['GuideCardKind', Object.values(GuideCardKind), GUIDE_CARD_KIND_VALUES],
    [
      'GuideCardPresentation',
      Object.values(GuideCardPresentation),
      GUIDE_CARD_PRESENTATION_VALUES,
    ],
    ['GuideCardState', Object.values(GuideCardState), GUIDE_CARD_STATE_VALUES],
    ['GuideTone', Object.values(GuideTone), GUIDE_TONE_VALUES],
    ['AgentChannel', Object.values(AgentChannel), GUIDE_CHANNEL_VALUES],
  ])('%s', (_name, dbValues, wireValues) => {
    expect(sorted(dbValues as string[])).toEqual(
      sorted(wireValues as readonly string[]),
    );
  });
});
