import {transformSummaryToFormData, transformFormDataForSubmission} from '../formDataTransformer';

jest.mock('@/constants/summary', () => ({
  SUMMARY_FIELDS: {
    SESSION_SUMMARY: 'sessionSummary',
    FLOW: 'counselingProcessFlow',
    KEY_CONCERNS: 'keyConcerns',
    OBJECTIVE_OBSERVATIONS: 'objectiveObservations',
    SUBJECTIVE_OBSERVATIONS: 'subjectiveObservations',
    ASSESSMENT: 'assessment',
    DOMINANT_FEELINGS: 'dominantFeelings',
    ISSUES_WORKED_ON: 'issuesWorkedOn',
    KEY_THERAPEUTIC_TECHNIQUES: 'keyTherapeuticTechniques',
    REFERRALS_PROVIDED: 'referralsProvided',
    HOMEWORK_RECOMMENDED: 'homework',
    PLAN_FOR_NEXT_CALL: 'planForNextCall',
    TAGS: 'tags',
    AGE: 'age',
    GENDER: 'gender',
    PROFESSION: 'profession',
    RELATIONSHIP_STATUS: 'relationshipStatus',
    LOCATION: 'location',
    CONCERN_CODE: 'codeOfConcern',
    ADDITIONAL_NOTES: 'notes',
  },
}));

jest.mock('@/utils/callSummary', () => ({
  mapTagsToString: (tags: any[]) => tags.map(t => t.tag).join(', '),
}));

describe('formDataTransformer', () => {
  it('transforms summary to formData', () => {
    const summary: any = {
      sessionSummary: 's',
      counselingProcessFlow: 'f',
      keyConcerns: 'k',
      objectiveObservations: 'o',
      subjectiveObservations: 'so',
      assessment: 'a',
      dominantFeelings: ['calm', 'happy'],
      issuesWorkedOn: 'i',
      keyTherapeuticTechniques: 't',
      referralsProvided: 'r',
      homework: 'h',
      planForNextCall: 'p',
      tags: [{tag: 'x'}],
      age: 30,
      gender: 'F',
      profession: 'P',
      relationshipStatus: 'R',
      location: 'L',
      codeOfConcern: 'C',
    };
    const form = transformSummaryToFormData(summary, {notes: 'N'} as any) as any;
    expect(form.sessionSummary).toBe('s');
    expect(form.dominantFeelings).toBe('calm, happy');
    expect(form.tags).toBe('x');
    expect(form.notes).toBe('N');
  });

  it('transforms formData back to summary payload', () => {
    const formData: any = {age: 25, gender: 'M', tags: 'ignored', notes: 'n'};
    const summaryData: any = {details: {summary: {existing: true}}};
    const tags = [{id: 1, tag: 'a'}] as any;
    const out = transformFormDataForSubmission(formData, summaryData, tags) as any;
    expect(out.age).toBe(25);
    expect(out.tags).toEqual(tags);
    expect(out.notes).toBe('n');
    expect(out.existing).toBe(true);
  });
});


