import {
  getChangedSummaryFieldKeys,
  transformFormDataForSubmission,
  transformSummaryToFormData,
} from '../formDataTransformer';

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

  describe('transformFormDataForSubmission', () => {
    it('sends only the changed keys, so untouched fields keep their stored values', () => {
      const formData: any = {age: 25, gender: 'M', keyConcerns: 'AI wrote this'};

      const patch = transformFormDataForSubmission(formData, ['age']) as any;

      // gender/keyConcerns are absent, so the backend merge leaves them alone.
      // The old version spread the whole stored summary and wrote every field
      // back, reverting anything added after the form was seeded.
      expect(patch).toEqual({age: 25});
    });

    it('sends a cleared field as an explicit null so the merge clears it', () => {
      const patch = transformFormDataForSubmission(
        {gender: null} as any,
        ['gender'],
      ) as any;

      expect(patch).toEqual({gender: null});
      expect('gender' in patch).toBe(true);
    });

    it('sends tag names, not a rated Tag[]', () => {
      const patch = transformFormDataForSubmission({tags: 'a, b'} as any, ['tags'], [
        'a',
        'b',
      ]) as any;

      expect(patch.tags).toEqual(['a', 'b']);
    });

    it('omits tags entirely when no names were supplied', () => {
      const patch = transformFormDataForSubmission({tags: 'a'} as any, [
        'tags',
      ]) as any;

      expect('tags' in patch).toBe(false);
    });

    it('produces an empty patch when nothing changed', () => {
      expect(transformFormDataForSubmission({age: 1} as any, [])).toEqual({});
    });
  });

  describe('getChangedSummaryFieldKeys', () => {
    it('lists only the fields that differ from the seeded baseline', () => {
      const baseline: any = {age: 25, gender: 'M', keyConcerns: 'original'};
      const current: any = {age: 26, gender: 'M', keyConcerns: 'original'};

      expect(getChangedSummaryFieldKeys(baseline, current)).toEqual(['age']);
    });

    it('counts a cleared field as changed', () => {
      expect(
        getChangedSummaryFieldKeys({gender: 'M'} as any, {gender: null} as any),
      ).toEqual(['gender']);
    });

    it('returns nothing when there is no baseline to compare against', () => {
      expect(getChangedSummaryFieldKeys(null, {age: 1} as any)).toEqual([]);
    });
  });
});


