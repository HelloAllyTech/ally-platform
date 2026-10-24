import { GuideSkill } from './guide-skill';

export const EXPLAIN_CORE_HELPING_SKILLS_SKILL: GuideSkill = {
  id: 'explain-core-helping-skills',
  version: 1,
  title: 'Explaining a core helping skill',
  whenToUse:
    'When the learner asks what a basic helping skill is or how to do it: listening, reflecting, open questions, summarising, empathy, silence, asking about safety.',
  instructions: `Explaining a core helping skill

1. Course first. Call consult_tutor and build on what the course itself says, naming where it is covered. If the course does not cover it, say so; then search_library may help.
2. Explain the skill by what it does for the person being helped, in one or two plain sentences, before any technique.
3. Give one short example line a helper might say, for the situation the learner is practising. Mark it as an example, not a script.
4. Name one common pitfall in a few words (asking several questions at once, reassuring too quickly).
5. Offer to try it: a one-line rehearsal now, or noticing it in their next practice call. One offer, never more.
6. Model the skill while you explain it: reflect their question back if it helps, ask before you tell.
7. Stay inside the reply budget. If they want more, they will ask.`,
};
