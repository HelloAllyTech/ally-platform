import {ViewedStatus} from '@/constants';
import {GetBadgesResponse, UserBadge} from '@/types';

// Generate a single mock badge
const generateMockBadge = (
  id: number,
  viewedStatus: ViewedStatus = ViewedStatus.UNVIEWED,
): UserBadge => {
  const badgeNames = [
    'First Steps',
    'Conversation Starter',
    'Active Listener',
    'Empathy Master',
    'Quick Responder',
    'Week Warrior',
    'Monthly Champion',
    'Feedback Pro',
    'Review Expert',
    'Community Builder',
  ];

  const badgeDescriptions = [
    'You completed your first simulation!',
    'You started your first conversation',
    'You demonstrated excellent listening skills',
    'You showed great empathy in your interactions',
    'You responded quickly to feedback',
    'You completed 7 days of practice',
    'You completed 30 days of practice',
    'You provided valuable feedback',
    'You wrote your first review',
    'You engaged with the community',
  ];

  const badgeCodes = [
    'FIRST_STEPS',
    'CONVERSATION_STARTER',
    'ACTIVE_LISTENER',
    'EMPATHY_MASTER',
    'QUICK_RESPONDER',
    'WEEK_WARRIOR',
    'MONTHLY_CHAMPION',
    'FEEDBACK_PRO',
    'REVIEW_EXPERT',
    'COMMUNITY_BUILDER',
  ];

  const imageUrls = [
    'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1556761175-4b46a572b786?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=400&fit=crop',
  ];

  const index = (id - 1) % badgeNames.length;
  const createdAt = new Date(
    Date.now() - (id - 1) * 86400000, // Different dates, one day apart
  ).toISOString();

  return {
    id: `badge-${id}`,
    badgeId: `badge-id-${id}`,
    userId: 12345,
    viewedStatus,
    createdAt,
    code: badgeCodes[index],
    name: badgeNames[index],
    description: badgeDescriptions[index],
    imageUrl: imageUrls[index],
  };
};

// Mock badges data for testing - UNVIEWED badges
export const mockUnviewedBadges: UserBadge[] = [
  generateMockBadge(1, ViewedStatus.UNVIEWED),
  generateMockBadge(2, ViewedStatus.UNVIEWED),
  generateMockBadge(3, ViewedStatus.UNVIEWED),
  generateMockBadge(4, ViewedStatus.UNVIEWED),
  generateMockBadge(5, ViewedStatus.UNVIEWED),
];

// Mock badges data for testing - VIEWED badges
export const mockViewedBadges: UserBadge[] = [
  generateMockBadge(1, ViewedStatus.VIEWED),
  generateMockBadge(2, ViewedStatus.VIEWED),
  generateMockBadge(3, ViewedStatus.VIEWED),
];

// Mock badges data for testing - Mixed badges
export const mockMixedBadges: UserBadge[] = [
  generateMockBadge(1, ViewedStatus.UNVIEWED),
  generateMockBadge(2, ViewedStatus.UNVIEWED),
  generateMockBadge(3, ViewedStatus.VIEWED),
  generateMockBadge(4, ViewedStatus.UNVIEWED),
  generateMockBadge(5, ViewedStatus.VIEWED),
];

// Mock API response for UNVIEWED badges
export const mockGetUnviewedBadgesResponse: GetBadgesResponse = {
  data: mockUnviewedBadges,
};

// Mock API response for VIEWED badges
export const mockGetViewedBadgesResponse: GetBadgesResponse = {
  data: mockViewedBadges,
};

// Mock API response with single badge
export const mockSingleBadgeResponse: GetBadgesResponse = {
  data: [generateMockBadge(1, ViewedStatus.UNVIEWED)],
};

// Mock API response with no badges
export const mockEmptyBadgesResponse: GetBadgesResponse = {
  data: [],
};

// Mock API response with many badges (for queue testing)
export const mockManyBadgesResponse: GetBadgesResponse = {
  data: Array.from({length: 10}, (_, i) =>
    generateMockBadge(
      i + 1,
      i % 3 === 0 ? ViewedStatus.VIEWED : ViewedStatus.UNVIEWED,
    ),
  ),
};

// Helper function to create custom mock badges
export const createMockBadges = (
  count: number,
  viewedStatus: ViewedStatus = ViewedStatus.UNVIEWED,
): UserBadge[] => {
  return Array.from({length: count}, (_, i) =>
    generateMockBadge(i + 1, viewedStatus),
  );
};

// Helper function to create mock response with custom badges
export const createMockBadgesResponse = (
  badges: UserBadge[],
): GetBadgesResponse => {
  return {
    data: badges,
  };
};

// Helper function to get mock response based on viewed status
export const getMockBadgesResponse = (
  viewedStatus: ViewedStatus = ViewedStatus.UNVIEWED,
): GetBadgesResponse => {
  if (viewedStatus === ViewedStatus.VIEWED) {
    return mockGetViewedBadgesResponse;
  }
  return mockGetUnviewedBadgesResponse;
};
