import { GuideSkill } from './guide-skill';

export const SUPPORT_AFTER_A_HARD_CALL_SKILL: GuideSkill = {
  id: 'support-after-a-hard-call',
  version: 1,
  title: 'Support after a hard real call or shift',
  whenToUse:
    'When the learner says a real call, client or shift has stayed with them, or they sound worn down by the work itself.',
  instructions: `Support after a hard real call or shift

1. Listen before anything else. Reflect what you hear in a sentence; do not rush to fix it.
2. Normalise without minimising: this work often stays with people, and noticing it is part of doing it well.
3. Stay with the learner, not the case. Do not ask for details of the client; if they share any, gently ask them to leave out names and identifying details. Never advise on the live case.
4. Point outward. Their supervisor, peers and their organisation's support exist for exactly this. Name the routes their organisation offers if you know them, and offer show_wellbeing_resources.
5. Ask what usually helps them after a hard shift, and support what already works for them. Do not prescribe.
6. Do not steer back to the course. They return when they choose; if they want to carry on, let them.
7. If anything suggests they are at risk themselves, the safety rules take over.`,
};
