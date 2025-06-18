import {SUMMARY_FIELDS} from '@/constants/summary';
import {AgeRange, CallSummaryResponse, Tag} from '@/services/callSummaryApi';

import {mapTagsToString} from '../callSummary';

export type FormData = {
  // Demographics - editable fields only
  [SUMMARY_FIELDS.AGE]: AgeRange | null;
  [SUMMARY_FIELDS.GENDER]: string | null;
  [SUMMARY_FIELDS.PROFESSION]: string | null;
  [SUMMARY_FIELDS.RELATIONSHIP_STATUS]: string | null;
  [SUMMARY_FIELDS.LOCATION]: string | null;
  [SUMMARY_FIELDS.CONCERN_CODE]: string | null;

  // Text content fields - all editable
  [SUMMARY_FIELDS.SESSION_SUMMARY]: string | null;
  [SUMMARY_FIELDS.FLOW]: string | null;
  [SUMMARY_FIELDS.KEY_CONCERNS]: string | null;
  [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]: string | null;
  [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]: string | null;
  [SUMMARY_FIELDS.ASSESSMENT]: string | null;
  [SUMMARY_FIELDS.DOMINANT_FEELINGS]: string | null;
  [SUMMARY_FIELDS.ISSUES_WORKED_ON]: string | null;
  [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]: string | null;
  [SUMMARY_FIELDS.REFERRALS_PROVIDED]: string | null;
  [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]: string | null;
  [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]: string | null;
  [SUMMARY_FIELDS.TAGS]: string | null;
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
  formData: FormData | null,
  summaryData: CallSummaryResponse,
  tags: Tag[],
): CallSummaryResponse['details']['summary'] => {
  return {
    ...summaryData?.details?.summary,
    [SUMMARY_FIELDS.AGE]: formData?.[SUMMARY_FIELDS.AGE] ?? null,
    [SUMMARY_FIELDS.GENDER]: formData?.[SUMMARY_FIELDS.GENDER] ?? null,
    [SUMMARY_FIELDS.PROFESSION]: formData?.[SUMMARY_FIELDS.PROFESSION] ?? null,
    [SUMMARY_FIELDS.CONCERN_CODE]:
      formData?.[SUMMARY_FIELDS.CONCERN_CODE] ?? null,
    [SUMMARY_FIELDS.RELATIONSHIP_STATUS]:
      formData?.[SUMMARY_FIELDS.RELATIONSHIP_STATUS] ?? null,
    [SUMMARY_FIELDS.LOCATION]: formData?.[SUMMARY_FIELDS.LOCATION] ?? null,
    [SUMMARY_FIELDS.SESSION_SUMMARY]:
      formData?.[SUMMARY_FIELDS.SESSION_SUMMARY] ?? null,
    [SUMMARY_FIELDS.FLOW]: formData?.[SUMMARY_FIELDS.FLOW] ?? null,
    [SUMMARY_FIELDS.KEY_CONCERNS]:
      formData?.[SUMMARY_FIELDS.KEY_CONCERNS] ?? null,
    [SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS]:
      formData?.[SUMMARY_FIELDS.OBJECTIVE_OBSERVATIONS] ?? null,
    [SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS]:
      formData?.[SUMMARY_FIELDS.SUBJECTIVE_OBSERVATIONS] ?? null,
    [SUMMARY_FIELDS.ASSESSMENT]: formData?.[SUMMARY_FIELDS.ASSESSMENT] ?? null,
    [SUMMARY_FIELDS.DOMINANT_FEELINGS]:
      formData?.[SUMMARY_FIELDS.DOMINANT_FEELINGS] ?? null,
    [SUMMARY_FIELDS.ISSUES_WORKED_ON]:
      formData?.[SUMMARY_FIELDS.ISSUES_WORKED_ON] ?? null,
    [SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES]:
      formData?.[SUMMARY_FIELDS.KEY_THERAPEUTIC_TECHNIQUES] ?? null,
    [SUMMARY_FIELDS.REFERRALS_PROVIDED]:
      formData?.[SUMMARY_FIELDS.REFERRALS_PROVIDED] ?? null,
    [SUMMARY_FIELDS.HOMEWORK_RECOMMENDED]:
      formData?.[SUMMARY_FIELDS.HOMEWORK_RECOMMENDED] ?? null,
    [SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL]:
      formData?.[SUMMARY_FIELDS.PLANS_FOR_NEXT_CALL] ?? null,
    [SUMMARY_FIELDS.TAGS]: tags,
  };
};
