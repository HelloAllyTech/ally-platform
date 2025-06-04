import {SUMMARY_FIELDS, SummaryFieldKey} from '@/constants/summary';
import {AgeRange, CallSummaryResponse, Tag} from '@/services/callSummaryApi';
import {SummaryFieldValueTypes} from '@/types/callSummary';

import {mapTagsToString} from '../callSummary';

export type FormData = {
  [key in SummaryFieldKey]?: SummaryFieldValueTypes | null;
};

export const transformSummaryToFormData = (
  summary: CallSummaryResponse['details']['summary'],
): FormData => ({
  [SUMMARY_FIELDS.SESSION_SUMMARY]: summary.sessionSummary || null,
  [SUMMARY_FIELDS.FLOW]: summary.counselingProcessFlow || null,
  [SUMMARY_FIELDS.KEY_CONCERNS]: summary.keyConcerns || null,
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
    summary.objectiveObservations || null,
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
    summary.subjectiveObservations || null,
  [SUMMARY_FIELDS.ASSESSMENT]: summary.assessment || null,
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: Array.isArray(summary.dominantFeelings)
    ? summary.dominantFeelings.join(', ')
    : summary.dominantFeelings || null,
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: summary.issuesWorkedOn || null,
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
    summary.keyTherapeuticTechniques || null,
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: summary.referralsProvided || null,
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: summary.homework || null,
  [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]: summary.planForNextCall || null,
  [SUMMARY_FIELDS.TAGS]: mapTagsToString(summary?.tags || []) || null,
  [SUMMARY_FIELDS.AGE]: summary.age || null,
  [SUMMARY_FIELDS.GENDER]: summary.gender || null,
  [SUMMARY_FIELDS.PROFESSION]: summary.profession || null,
  [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: summary.relationshipStatus || null,
  [SUMMARY_FIELDS.LOCATION]: summary.location || null,
  [SUMMARY_FIELDS.CONCERN_CODE]: summary.codeOfConcern || null,
});

export const transformFormDataForSubmission = (
  formData: FormData,
  summaryData: CallSummaryResponse,
  tags: Tag[],
): CallSummaryResponse['details']['summary'] => {
  return {
    ...summaryData?.details?.summary,
    [SUMMARY_FIELDS.AGE]: formData[SUMMARY_FIELDS.AGE] as AgeRange | null,
    [SUMMARY_FIELDS.GENDER]: formData[SUMMARY_FIELDS.GENDER] as string | null,
    [SUMMARY_FIELDS.PROFESSION]: formData[SUMMARY_FIELDS.PROFESSION] as
      | string
      | null,
    [SUMMARY_FIELDS.CONCERN_CODE]: formData[SUMMARY_FIELDS.CONCERN_CODE] as
      | string
      | null,
    [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: formData[
      SUMMARY_FIELDS.RELATIONSHIP_STATUS
    ] as string | null,
    [SUMMARY_FIELDS.LOCATION]: formData[SUMMARY_FIELDS.LOCATION] as
      | string
      | null,
    [SUMMARY_FIELDS.SESSION_SUMMARY]: formData[
      SUMMARY_FIELDS.SESSION_SUMMARY
    ] as string | null,
    [SUMMARY_FIELDS.FLOW]: formData[SUMMARY_FIELDS.FLOW] as string | null,
    [SUMMARY_FIELDS.KEY_CONCERNS]: formData[SUMMARY_FIELDS.KEY_CONCERNS] as
      | string
      | null,
    [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]: formData[
      SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS
    ] as string | null,
    [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]: formData[
      SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS
    ] as string | null,
    [SUMMARY_FIELDS.ASSESSMENT]: formData[SUMMARY_FIELDS.ASSESSMENT] as
      | string
      | null,
    [SUMMARY_FIELDS.DOMINANT_FEELINGS]: formData[
      SUMMARY_FIELDS.DOMINANT_FEELINGS
    ] as string | null,
    [SUMMARY_FIELDS.ISSUES_WORKED_ON]: formData[
      SUMMARY_FIELDS.ISSUES_WORKED_ON
    ] as string | null,
    [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]: formData[
      SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES
    ] as string | null,
    [SUMMARY_FIELDS.REFERRALS_PROVIDED]: formData[
      SUMMARY_FIELDS.REFERRALS_PROVIDED
    ] as string | null,
    [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: formData[
      SUMMARY_FIELDS.HOMEWORK_RECOMMENDED
    ] as string | null,
    [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]: formData[
      SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL
    ] as string | null,
    [SUMMARY_FIELDS.TAGS]: tags,
  };
};
