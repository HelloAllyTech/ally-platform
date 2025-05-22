import {CallSummaryResponse} from '@/services/callSummaryApi';
import {
  CallSummaryAPIResponse,
  FormattedSummaryValues,
} from '@/types/callSummary';

// Dummy data for development and fallback
const CALL_SUMMARY_DATA = {
  callDetails: {
    date: '11th February 2025',
    time: '11:03 – 11:32',
    type: 'Repeat caller, 3rd call',
    counsellor: 'Shruti Bhatia',
  },
  keyConcern:
    "-> Made space for the client to share thoughts and experiences. \n -> Validated their experiences and acknowledged the difficulty of caregiving. \n Reframed self-care and taking time off as not selfish. \n -> Encouraged a small behavioural experiment for letting go of. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict.",
  callHighlights: {
    duration: 30,
    questions: 6,
    copilot: 4,
    listeningRatio: 0.67,
    moodImproved: 28,
  },
  demographics: {
    callerId: '134567',
    age: 28,
    gender: 'Male',
    profession: 'Engineer',
    concernCode: 'Seeking information',
    diagnosis: 'Depression',
    location: 'Mumbai',
  },
  flow: "-> Made space for the client to share thoughts and experiences. \n -> Validated their experiences and acknowledged the difficulty of caregiving. \n Reframed self-care and taking time off as not selfish. \n -> Encouraged a small behavioural experiment for letting go of. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict.",
};

const getDateWithOrdinal = (dateTime: string | undefined) => {
  if (!dateTime) return '--';
  const date = new Date(dateTime);
  const day = date.getDate();
  const suffix = ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
  return `${day}${suffix} ${date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })}`;
};

const get24HourTime = (dateTime: string | undefined) => {
  if (!dateTime) return '--';
  const date = new Date(dateTime);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// Use SummaryValues type for FutureAPIResponse
type FutureAPIResponse = CallSummaryAPIResponse;

export const getFormattedCallSummary = (
  response: CallSummaryResponse | undefined,
  futureResponse?: FutureAPIResponse,
): FormattedSummaryValues => {
  // Extract data from current API response
  const {details} = response || {};
  const {
    session_details: sessionDetails,
    demographic_details: demographics,
    session_documentation: sessionDocs,
  } = details?.summary?.summaryNote || {};

  // Priority-based field resolution (for now)
  // TO DO: Remove priority-based field resolution once future API is implemented
  return {
    // Call Details section
    callDate:
      futureResponse?.callDate || // Try future API first
      (response?.startedAt
        ? getDateWithOrdinal(response.startedAt)
        : undefined) || // Then current API
      CALL_SUMMARY_DATA.callDetails.date, // Finally fallback to dummy data

    callTime:
      futureResponse?.callTime ||
      (response?.startedAt && response?.endedAt
        ? `${get24HourTime(response.startedAt)} - ${get24HourTime(response.endedAt)}`
        : undefined) ||
      CALL_SUMMARY_DATA.callDetails.time,

    callerType:
      futureResponse?.callerType ||
      sessionDetails?.new_call_follow_up ||
      CALL_SUMMARY_DATA.callDetails.type,

    counsellorName:
      futureResponse?.counsellorName ||
      sessionDetails?.counselor_name ||
      CALL_SUMMARY_DATA.callDetails.counsellor,

    // demographics section
    callerId:
      futureResponse?.callerId ||
      response?.clientId?.toString() ||
      CALL_SUMMARY_DATA.demographics.callerId,

    age:
      futureResponse?.age ||
      demographics?.age ||
      CALL_SUMMARY_DATA.demographics.age,

    gender:
      futureResponse?.gender ||
      demographics?.gender ||
      CALL_SUMMARY_DATA.demographics.gender,

    // TO DO: Check if this is shown
    location:
      futureResponse?.location ||
      demographics?.location ||
      CALL_SUMMARY_DATA.demographics.location,

    profession:
      futureResponse?.profession ||
      demographics?.working_status ||
      CALL_SUMMARY_DATA.demographics.profession,

    concernCode:
      futureResponse?.concernCode ||
      demographics?.code_of_concern ||
      CALL_SUMMARY_DATA.demographics.concernCode,

    formalDiagnosis:
      futureResponse?.formalDiagnosis ||
      demographics?.any_formal_diagnosis ||
      CALL_SUMMARY_DATA.demographics.diagnosis,

    // Call Highlights section
    // TO DO: Verify the type of callDuration
    callLastedOver:
      futureResponse?.callLastedOver ||
      details?.callDuration ||
      CALL_SUMMARY_DATA.callHighlights.duration,

    youAsked:
      futureResponse?.youAsked ||
      details?.noOfStages ||
      CALL_SUMMARY_DATA.callHighlights.questions,

    usedCopilot:
      futureResponse?.usedCopilot ||
      details?.noOfNudges ||
      CALL_SUMMARY_DATA.callHighlights.copilot,

    // Not available in current API, only in future API
    // TO DO: Check type
    listeningRatio:
      futureResponse?.listeningRatio ||
      CALL_SUMMARY_DATA.callHighlights.listeningRatio,

    // Not available in current API, only in future API
    // TO DO: Check type
    moodImprovedBy:
      futureResponse?.moodImprovedBy ||
      CALL_SUMMARY_DATA.callHighlights.moodImproved,

    // Other fields
    flow:
      futureResponse?.flow ||
      sessionDocs?.work_done?.counseling_process_flow ||
      CALL_SUMMARY_DATA.flow,

    keyConcerns:
      futureResponse?.keyConcerns ||
      sessionDocs?.key_concerns ||
      CALL_SUMMARY_DATA.keyConcern,
  };
};
