import reducer, {
  clearSummaryStates,
  selectCallDetails,
  selectCallInfo,
  selectFormData,
  selectMetrics,
  selectSummary,
  selectSummaryData,
  selectSummaryVisibleFields,
  setFormData,
  setSummaryData,
  setSummaryVisibleFields,
} from '@/store/slices/summarySlice';
import {CallSummaryResponse} from '@/services/callSummaryApi';

const makeSummaryResponse = (): CallSummaryResponse => ({
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T01:00:00.000Z',
  tenantId: 't1',
  id: 100,
  roomId: 200,
  clientId: 300,
  counselorId: 400,
  status: 'COMPLETED',
  startedAt: '2024-01-01T00:00:00.000Z',
  endedAt: '2024-01-01T01:00:00.000Z',
  summaryStatus: 'SUCCESS' as any,
  archivedAt: '2024-01-01T02:00:00.000Z',
  details: {
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T01:00:00.000Z',
    tenantId: 't1',
    id: 10,
    chatId: 11,
    callDuration: 1200,
    startTime: '2024-01-01T00:00:00.000Z',
    endTime: '2024-01-01T01:00:00.000Z',
    noOfNudges: 0,
    noOfStages: 0,
    transcript: '...transcript...',
    callOutcome: null,
    callInfo: {
      summaryName: 'Call 1',
      isSummaryFeedbackAdded: false,
      clientTalkingTime: 600,
      wordCountByLanguage: {en: 1000},
      counselorTalkingTime: 600,
      clientTalkingPercentage: '50%',
      counselorTalkingPercentage: '50%',
      provider: 'MICROPHONE' as any,
      notes: null,
    },
    summary: {
      callId: 10,
      callDuration: 1200,
      callDate: '2024-01-01',
      callTime: '00:00',
      clientId: 'c1',
      counsellor: 'Counselor',
      callType: 'Type',
      age: '25-34' as any,
      gender: 'Male',
      profession: 'Engineer',
      relationshipStatus: 'Single',
      languages: [{language: 'English', percentage: 100}],
      location: 'City',
      codeOfConcern: 'A',
      sessionSummary: 'Summary',
      counselingProcessFlow: 'Flow',
      keyConcerns: 'Concerns',
      objectiveObservations: 'Objective',
      subjectiveObservations: 'Subjective',
      assessment: 'Assessment',
      dominantFeelings: 'Calm',
      issuesWorkedOn: 'Issues',
      keyTherapeuticTechniques: 'Techniques',
      referralsProvided: 'Referrals',
      homework: 'Homework',
      planForNextCall: 'Plan',
      tags: [{tag: 'tag1', priority_rating: 1}],
      listeningShare: 70,
      reflectiveQuestionsAsked: 2,
      emotionalLift: 3,
      workingStatus: 'Working',
      newCallFollowUp: 'Yes',
      followUpGoals: 'Goals',
      sessionNumber: '1',
      followUpStatus: 'Pending',
      followUpDate: '2024-01-02',
      counselorFeelings: 'Neutral',
      anyFormalDiagnosis: 'No',
      emotionalStateStart: 'Low',
      emotionalStateChange: 'Increase',
      therapeuticInterventions: 'Interventions',
      callQuality: 5,
      additionalNotes: 'Notes',
      openEndedQuestionsAsked: 1,

      // Intake section
      intakeNotes: null,
      riskSelfHarm: null,
      riskSelfHarmNotes: null,
      riskSuicidalThoughts: null,
      riskSuicidalThoughtsNotes: null,
      riskSuicidalPlan: null,
      riskSuicidalAction: null,
      riskRunningAway: null,
      riskRunningAwayNotes: null,
      traumaPhysicalAbuse: null,
      traumaSexualAbuse: null,
      traumaVerbalAbuse: null,
      traumaNeglect: null,
      traumaSeparationFromCaregiverParent: null,
      traumaWitnessedDomesticViolence: null,
      traumaNotes: null,
      assessmentPsychologicalDiagnosis: null,
      assessmentPsychologicalDiagnosisNotes: null,
      assessmentUseOfPsychotropicMedications: null,
      assessmentUseOfPsychotropicMedicationsNotes: null,
      assessmentHallucinations: null,
      assessmentHallucinationsNotes: null,
      assessmentAffect: null,
      assessmentSpeech: null,

      // Ongoing Risks section
      ongoingRiskSelfHarm: null,
      ongoingRiskSelfHarmNotes: null,
      ongoingRiskSuicidalThoughts: null,
      ongoingRiskSuicidalPlan: null,
      ongoingRiskSuicidalAction: null,
      ongoingRiskSuicidalThoughtsNotes: null,
    },
  },
});

describe('summarySlice reducers', () => {
  it('should return initial state', () => {
    const state = reducer(undefined, {type: 'unknown'} as any);
    expect(state.summaryData).toBeNull();
    expect(state.formData).toBeNull();
    expect(state.visibleFields).toEqual([]);
  });

  it('setSummaryData should set API response', () => {
    const payload = makeSummaryResponse();
    const next = reducer(undefined, setSummaryData(payload));
    expect(next.summaryData).toEqual(payload);
  });

  it('setFormData should merge partial form data', () => {
    const next = reducer(
      undefined,
      setFormData({sessionSummary: 'New Summary', age: '18-24' as any}),
    );
    expect(next.formData?.sessionSummary).toBe('New Summary');
    expect(next.formData?.age).toBe('18-24');
  });

  it('setSummaryVisibleFields should set visible fields', () => {
    const next = reducer(undefined, setSummaryVisibleFields(['sessionSummary']));
    expect(next.visibleFields).toEqual(['sessionSummary']);
  });

  it('clearSummaryStates should reset summaryData and formData', () => {
    const withData = reducer(
      undefined,
      setSummaryData(makeSummaryResponse()),
    );
    const cleared = reducer(withData, clearSummaryStates());
    expect(cleared.summaryData).toBeNull();
    expect(cleared.formData).toBeNull();
  });
});

describe('summarySlice selectors', () => {
  const baseState = reducer(
    undefined,
    setSummaryData(makeSummaryResponse()),
  );
  const root = {summary: baseState} as any;

  it('selectSummaryData returns full response', () => {
    expect(selectSummaryData(root)).toEqual(baseState.summaryData);
  });

  it('selectFormData returns form data', () => {
    const updated = reducer(baseState, setFormData({sessionSummary: 'x'}));
    const updatedRoot = {summary: updated} as any;
    expect(selectFormData(updatedRoot)).toEqual(updated.formData);
  });

  it('selectSummary returns details.summary', () => {
    expect(selectSummary(root)).toEqual(
      baseState.summaryData?.details?.summary,
    );
  });

  it('selectCallDetails returns mapped fields with clientId', () => {
    expect(selectCallDetails(root)).toMatchObject({
      clientId: baseState.summaryData?.clientId,
    });
  });

  it('selectCallInfo returns expected info', () => {
    expect(selectCallInfo(root)).toMatchObject({
      chatId: baseState.summaryData?.details?.chatId,
      clientId: baseState.summaryData?.clientId,
      summaryName: baseState.summaryData?.details?.callInfo?.summaryName,
    });
  });

  it('selectMetrics returns listeningShare / reflectiveQuestionsAsked / emotionalLift', () => {
    expect(selectMetrics(root)).toEqual({
      listeningShare:
        baseState.summaryData?.details?.callInfo?.clientTalkingPercentage ?? null,
      reflectiveQuestionsAsked:
        baseState.summaryData?.details?.summary?.reflectiveQuestionsAsked ?? null,
      emotionalLift:
        baseState.summaryData?.details?.summary?.emotionalLift ?? null,
    });
  });

  it('selectSummaryVisibleFields returns fields array', () => {
    const updated = reducer(baseState, setSummaryVisibleFields(['sessionSummary']));
    const updatedRoot = {summary: updated} as any;
    expect(selectSummaryVisibleFields(updatedRoot)).toEqual(['sessionSummary']);
  });
});


