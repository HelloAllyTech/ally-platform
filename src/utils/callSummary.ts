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
    relationshipStatus: 'Married',
    concernCode: 'Seeking information',
    diagnosis: 'Depression',
    location: 'Mumbai',
    languages: 'Hindi (92%), English (8%)',
  },
  flow: "-> Made space for the client to share thoughts and experiences. \n -> Validated their experiences and acknowledged the difficulty of caregiving. \n Reframed self-care and taking time off as not selfish. \n -> Encouraged a small behavioural experiment for letting go of. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict.",
  objectiveObservations:
    'Client appeared anxious and fidgety during the call. Spoke rapidly and had difficulty maintaining focus. Showed signs of emotional distress when discussing work-related stress.',
  subjectiveObservations:
    'Client seems to be struggling with work-life balance and shows signs of burnout. Demonstrates high self-criticism and perfectionist tendencies.',
  assessment:
    'Client is experiencing moderate to severe anxiety symptoms, primarily triggered by work-related stress and perfectionist tendencies. Shows good insight into their patterns but struggles with implementing changes.',
  dominantFeelings: 'Anxiety, frustration, overwhelm, self-doubt',
  issuesWorkedOn:
    '1. Work-related stress\n2. Perfectionism\n3. Self-care strategies\n4. Boundary setting',
  therapeuticTechniques:
    '1. Active listening\n2. Cognitive restructuring\n3. Mindfulness exercises\n4. Solution-focused questioning',
  referralsProvided:
    '1. Workplace counseling program\n2. Stress management workshop\n3. Local support group for professionals',
  homeworkRecommended:
    '1. Daily mindfulness practice (10 minutes)\n2. Stress diary\n3. Setting one boundary per day\n4. Self-care activity schedule',
  plansForNextCall:
    '1. Review homework completion\n2. Explore progress with boundary setting\n3. Discuss any new challenges\n4. Refine coping strategies',
  tags: 'anxiety, work-stress, perfectionism, self-care',
  metrics: {
    listeningShare: '75%',
    reflectiveQuestionsAsked: '8',
    emotionalLift: '30%',
  },
  notes:
    'Follow up on stress diary entries and boundary-setting exercises in next session. Client shows good engagement and motivation for change.',
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

const get24HourTime = (dateTime: string) => {
  const date = new Date(dateTime);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};
