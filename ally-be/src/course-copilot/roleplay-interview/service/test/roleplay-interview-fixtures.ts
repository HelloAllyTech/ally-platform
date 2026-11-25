import { RoleplayInterviewBrief } from '../../type/roleplay-interview.type';

export const COMPLETE_BRIEF: RoleplayInterviewBrief = {
  learners: { who: 'Helpline volunteers', priorExperience: 'none' },
  goal: 'Ask directly about suicide when a caller hints at it',
  competencyIds: ['11111111-1111-4111-8111-111111111111'],
  competencyNames: ['Risk assessment'],
  mode: 'practice',
  difficulty: 'MEDIUM',
  client: { description: 'A student who hints at not wanting to wake up' },
  // The library was searched and nothing fits: a new character may be written.
  characterChoice: { searched: true, matches: 0 },
  setting: 'A late-night helpline call',
  languages: [{ languageId: 'l-1', label: 'English', code: 'en-US' }],
  notes: ['Keep it under ten minutes'],
};

export const PLAN_INPUT = {
  title: 'Asking about suicide',
  characterSheet: {
    name: 'Riya',
    summary: 'A 20-year-old student, exhausted by exams.',
    hides: 'She has thought about not waking up.',
    opensUpWhen: 'The helper asks gently and directly.',
    speaks: 'Short, flat sentences.',
  },
  moments: ['Mentions not sleeping', 'Hints at not wanting to wake up'],
  states: [
    { name: 'Guarded', guidelines: 'Deflects.' },
    { name: 'Testing', guidelines: 'Drops a hint.' },
    { name: 'Open', guidelines: 'Says it plainly.' },
  ],
  passCriteria: {
    helpful: ['Asks directly about suicide'],
    unhelpful: ['Changes the subject'],
    minScore: 60,
  },
  openingLine: "I don't really know why I called.",
};
