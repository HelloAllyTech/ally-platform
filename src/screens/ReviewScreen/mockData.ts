// src/hooks/__mocks__/mockReviewsData.ts
import {ReviewItem, ReviewsResponse} from '@/types/reviews';

// Generate mock review items
const generateMockReview = (id: number): ReviewItem => ({
  id: id.toString(),
  createdAt: new Date(Date.now() - id * 86400000).toISOString(), // Different dates
  scenario: {
    title: `Review Scenario ${id}`,
    description: `This is a very very very very very long description for testing the text truncation and description expansion ${id}`,
    coverImageUrl: `https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop`,
    createdAt: new Date(Date.now() - id * 86400000).toISOString(),
    duration: `${Math.floor(Math.random() * 1000)}`,
  },
  reactions: {
    '1F44D': Math.floor(Math.random() * 50),
    '2764-FE0F': Math.floor(Math.random() * 30),
    '1F44F': Math.floor(Math.random() * 20),
    '1F604': Math.floor(Math.random() * 40),
  },
  commentsCount: Math.floor(Math.random() * 20),
  createdBy: {
    id: (id * 100).toString(),
    name: `User ${id}`,
    profileImage: `https://i.pravatar.cc/150?img=${id}`,
  },
});

// Total number of mock reviews to simulate
const TOTAL_MOCK_REVIEWS = 35; // Change this to test different scenarios

// Mock API function that simulates pagination
export const mockGetReviews = async (params: {
  sortBy: string;
  limit: number;
  offset: number;
}): Promise<{data: ReviewsResponse | null}> => {
  const {limit, offset} = params;

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  // Generate all mock reviews
  const allReviews: ReviewItem[] = Array.from(
    {length: TOTAL_MOCK_REVIEWS},
    (_, i) => generateMockReview(i + 1),
  );

  // Sort based on sortBy parameter (simplified)
  let sortedReviews = [...allReviews];
  if (params.sortBy === 'createdAt') {
    sortedReviews.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } else if (params.sortBy === 'reactionsCount') {
    sortedReviews.sort((a, b) => {
      const aTotal = Object.values(a.reactions).reduce(
        (sum, count) => sum + count,
        0,
      );
      const bTotal = Object.values(b.reactions).reduce(
        (sum, count) => sum + count,
        0,
      );
      return bTotal - aTotal;
    });
  } else if (params.sortBy === 'commentsCount') {
    sortedReviews.sort(
      (a, b) => (b.commentsCount || 0) - (a.commentsCount || 0),
    );
  }

  // Get paginated slice
  const paginatedReviews = sortedReviews.slice(offset, offset + limit);

  const response: ReviewsResponse = {
    data: paginatedReviews,
    count: TOTAL_MOCK_REVIEWS,
  };

  return {data: response};
};

// Alternative: Mock with error simulation
export const mockGetReviewsWithError = async (params: {
  sortBy: string;
  limit: number;
  offset: number;
}): Promise<{data: ReviewsResponse | null}> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  // Simulate error on page 3
  if (params.offset >= 20) {
    throw new Error('Network error');
  }

  return mockGetReviews(params);
};
