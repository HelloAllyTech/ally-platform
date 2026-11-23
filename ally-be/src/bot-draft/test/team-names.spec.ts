import { LearnedSection } from '../enum/bot-draft.enum';
import { teamNames } from '../service/team-names';

describe('teamNames (chunk 20d)', () => {
  it('takes the name from each Team fact, once, in order', () => {
    expect(
      teamNames([
        {
          section: LearnedSection.TEAM,
          text: 'Dr Kavya Iyer is Clinical Psychologist and founder, works with anxiety.',
        },
        {
          section: LearnedSection.TEAM,
          text: 'Rohan Deshpande is Counselling Psychologist, works with stress.',
        },
        {
          section: LearnedSection.ABOUT,
          text: 'Sunrise Mind Clinic is a practice in Baner.',
        },
        {
          section: LearnedSection.TEAM,
          text: 'Sara Fernandes – Couples and Family Therapist',
        },
        {
          section: LearnedSection.TEAM,
          text: 'Rohan Deshpande speaks Marathi.',
        },
        {
          section: LearnedSection.TEAM,
          text: 'Our team speaks English, Hindi and Marathi.',
        },
        { section: LearnedSection.TEAM, text: 'We have 6 therapists.' },
      ]),
    ).toEqual(['Dr Kavya Iyer', 'Rohan Deshpande', 'Sara Fernandes']);
  });
});
