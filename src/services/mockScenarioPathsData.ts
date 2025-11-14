/**
 * Mock Data for Scenario Paths
 *
 * This file contains realistic mock data that EXACTLY matches the API contract.
 * Use this for development and testing until the real API endpoints are ready.
 *
 * API Contract Reference:
 * - GET /scenario-paths → SimulationPathsResponse
 * - GET /scenario-paths/:pathId → SimulationPathDetailsResponse
 */

import type {
  ScenarioPathStatus,
  SimulationPath,
  SimulationPathDetails,
} from '@/types';

/**
 * Mock data for scenario paths listing
 * Endpoint: GET /scenario-paths
 */
export const MOCK_SCENARIO_PATHS: SimulationPath[] = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    title: 'Sales Mastery Path',
    description:
      'Master the art of sales through progressive scenarios covering fundamentals to advanced techniques',
    coverImageUrl:
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=400',
    totalScenarios: 4,
    sessionStatus: 'IN_PROGRESS' as ScenarioPathStatus,
    completedScenarios: 1,
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    title: 'Clinical Excellence Journey',
    description:
      'Develop clinical skills through realistic patient interactions and case studies',
    coverImageUrl:
      'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=400',
    totalScenarios: 5,
    sessionStatus: 'IN_PROGRESS' as ScenarioPathStatus,
    completedScenarios: 2,
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    title: 'Customer Service Excellence',
    description:
      'Learn to handle difficult customers and resolve conflicts effectively',
    coverImageUrl:
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400',
    totalScenarios: 3,
    sessionStatus: 'COMPLETED' as ScenarioPathStatus,
    completedScenarios: 3,
  },
  {
    id: 'd4e5f6a7-b8c9-0123-def1-234567890123',
    title: 'Leadership Development Path',
    description:
      'Build essential leadership skills through team management scenarios',
    coverImageUrl:
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400',
    totalScenarios: 6,
    sessionStatus: 'IN_PROGRESS' as ScenarioPathStatus,
    completedScenarios: 0,
  },
];

/**
 * Mock data for individual path details
 * Endpoint: GET /scenario-paths/:pathId
 */
export const MOCK_PATH_DETAILS: Record<string, SimulationPathDetails> = {
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890': {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Sales Mastery Path',
    description:
      'Master the art of sales through progressive scenarios covering fundamentals to advanced techniques',
    coverImageUrl:
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=400',
    userId: 1,
    completedAt: null,
    completedScenarios: 1,
    totalScenarios: 4,
    scenarios: [
      {
        sessionItemId: 1,
        scenarioId: 101,
        coverImageUrl:
          'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=400',
        coverVideoUrl:
          'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        description:
          'Learn the fundamentals of sales including product knowledge, customer engagement, and basic closing techniques.',
        scenarioTitle: 'Sales Basics',
        order: 100,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 2,
        scenarioId: 102,
        coverImageUrl:
          'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400',
        coverVideoUrl:
          'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
        description:
          'Master the art of handling customer objections and turning challenges into opportunities.',
        scenarioTitle: 'Objection Handling',
        order: 200,
        status: 'IN_PROGRESS' as ScenarioPathStatus,
      },
      {
        sessionItemId: 3,
        scenarioId: 103,
        coverImageUrl:
          'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=400',
        description:
          'Develop advanced negotiation skills to close high-value deals effectively.',
        scenarioTitle: 'Advanced Negotiation',
        order: 300,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 4,
        scenarioId: 104,
        coverImageUrl:
          'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=400',
        description:
          'Learn to build long-term relationships and ensure customer success for repeat business.',
        scenarioTitle: 'Customer Success Management',
        order: 400,
        status: 'LOCKED' as ScenarioPathStatus,
      },
    ],
  },
  'b2c3d4e5-f6a7-8901-bcde-f12345678901': {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    name: 'Clinical Excellence Journey',
    description:
      'Develop clinical skills through realistic patient interactions and case studies',
    coverImageUrl:
      'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=400',
    userId: 1,
    completedAt: null,
    completedScenarios: 2,
    totalScenarios: 5,
    scenarios: [
      {
        sessionItemId: 5,
        scenarioId: 201,
        coverImageUrl:
          'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=400',
        description:
          'Practice initial patient assessment and history taking in a clinical setting.',
        scenarioTitle: 'Patient Assessment Basics',
        order: 100,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 6,
        scenarioId: 202,
        coverImageUrl:
          'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=400',
        description:
          'Learn to diagnose common conditions through symptom analysis and clinical reasoning.',
        scenarioTitle: 'Diagnostic Reasoning',
        order: 200,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 7,
        scenarioId: 203,
        coverImageUrl:
          'https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=400',
        description:
          'Practice creating effective treatment plans tailored to patient needs.',
        scenarioTitle: 'Treatment Planning',
        order: 300,
        status: 'IN_PROGRESS' as ScenarioPathStatus,
      },
      {
        sessionItemId: 8,
        scenarioId: 204,
        coverImageUrl:
          'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=400',
        description:
          'Develop skills in delivering difficult news with empathy and professionalism.',
        scenarioTitle: 'Delivering Difficult News',
        order: 400,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 9,
        scenarioId: 205,
        coverImageUrl:
          'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=400',
        description:
          'Handle complex medical emergencies with quick decision-making and appropriate interventions.',
        scenarioTitle: 'Emergency Response',
        order: 500,
        status: 'LOCKED' as ScenarioPathStatus,
      },
    ],
  },
  'c3d4e5f6-a7b8-9012-cdef-123456789012': {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    name: 'Customer Service Excellence',
    description:
      'Learn to handle difficult customers and resolve conflicts effectively',
    coverImageUrl:
      'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400',
    userId: 1,
    completedAt: '2024-01-15T10:30:00Z',
    completedScenarios: 3,
    totalScenarios: 3,
    scenarios: [
      {
        sessionItemId: 10,
        scenarioId: 301,
        coverImageUrl:
          'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400',
        description:
          'Master active listening and empathetic communication with customers.',
        scenarioTitle: 'Active Listening Skills',
        order: 100,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 11,
        scenarioId: 302,
        coverImageUrl:
          'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=400',
        description:
          'Learn de-escalation techniques for handling angry or frustrated customers.',
        scenarioTitle: 'Conflict De-escalation',
        order: 200,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 12,
        scenarioId: 303,
        coverImageUrl:
          'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=400',
        description:
          'Develop problem-solving skills to find creative solutions to customer issues.',
        scenarioTitle: 'Creative Problem Solving',
        order: 300,
        status: 'COMPLETED' as ScenarioPathStatus,
      },
    ],
  },
  'd4e5f6a7-b8c9-0123-def1-234567890123': {
    id: 'd4e5f6a7-b8c9-0123-def1-234567890123',
    name: 'Leadership Development Path',
    description:
      'Build essential leadership skills through team management scenarios',
    coverImageUrl:
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400',
    userId: 1,
    completedAt: null,
    completedScenarios: 0,
    totalScenarios: 6,
    scenarios: [
      {
        sessionItemId: 13,
        scenarioId: 401,
        coverImageUrl:
          'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=400',
        description:
          'Learn the foundations of effective team leadership and management.',
        scenarioTitle: 'Leadership Fundamentals',
        order: 100,
        status: 'IN_PROGRESS' as ScenarioPathStatus,
      },
      {
        sessionItemId: 14,
        scenarioId: 402,
        coverImageUrl:
          'https://images.unsplash.com/photo-1552664730-d307ca884978?w=400',
        description:
          'Master the art of delegating tasks effectively while maintaining accountability.',
        scenarioTitle: 'Effective Delegation',
        order: 200,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 15,
        scenarioId: 403,
        coverImageUrl:
          'https://images.unsplash.com/photo-1556761175-4b46a572b786?w=400',
        description:
          'Provide constructive feedback that motivates and develops team members.',
        scenarioTitle: 'Giving Feedback',
        order: 300,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 16,
        scenarioId: 404,
        coverImageUrl:
          'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=400',
        description:
          'Resolve team conflicts and maintain a positive work environment.',
        scenarioTitle: 'Conflict Resolution',
        order: 400,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 17,
        scenarioId: 405,
        coverImageUrl:
          'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400',
        description:
          'Learn to motivate and inspire your team to achieve their best.',
        scenarioTitle: 'Team Motivation',
        order: 500,
        status: 'LOCKED' as ScenarioPathStatus,
      },
      {
        sessionItemId: 18,
        scenarioId: 406,
        coverImageUrl:
          'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400',
        description:
          'Develop strategic thinking and long-term planning skills for organizational success.',
        scenarioTitle: 'Strategic Planning',
        order: 600,
        status: 'LOCKED' as ScenarioPathStatus,
      },
    ],
  },
};

/**
 * Helper function to get path details by ID
 * Mimics API call: GET /scenario-paths/:pathId
 */
export const getMockPathDetailsById = (
  pathId: string,
): SimulationPathDetails | null => {
  const pathDetails = MOCK_PATH_DETAILS[pathId];
  if (!pathDetails) {
    return null;
  }
  return pathDetails;
};
