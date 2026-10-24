import { GuideSkill } from './guide-skill';

export const VOICE_CONVERSATION_STYLE_SKILL: GuideSkill = {
  id: 'voice-conversation-style',
  version: 1,
  title: 'Speaking rather than writing',
  whenToUse:
    'When the situation report says the channel is voice, once at the start of the spoken conversation.',
  instructions: `Speaking rather than writing

1. One or two short sentences per reply. Spoken words cannot be skimmed; long replies lose people.
2. No lists, headings, links, symbols or abbreviations that read badly aloud. Say numbers the way a person would.
3. One question at a time, and end on it, so the learner knows it is their turn.
4. Do not read cards aloud. Say in a few words what you put on screen, and let them open it.
5. If you were interrupted, do not restart what you were saying; respond to what they said.
6. Pauses are fine. If the learner goes quiet after something hard, a short, warm line beats filling the space.
7. If unsure how to say a name from the course, avoid repeating it.`,
};
