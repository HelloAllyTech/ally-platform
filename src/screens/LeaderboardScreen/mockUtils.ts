import {LeaderboardEntry} from './LeaderboardScreen';

/**
 * Mock utility functions for LeaderboardScreen
 * These will be replaced when API is available
 */

export const generateMockLeaderboardData = (
  currentUserRank: number,
): LeaderboardEntry[] => {
  const entries: LeaderboardEntry[] = [];
  const names = [
    'Sarah Johnson',
    'Maria Garcia',
    'Emily Johnson',
    'Michael Smith',
    'Sarah Brown',
    'David Wilson',
    'Laura Green',
    'James Anderson',
    'Emma Davis',
    'Robert Taylor',
    'Yedhu krishnan',
  ];

  for (let i = 1; i <= 10; i++) {
    if (i === currentUserRank && currentUserRank <= 10) {
      entries.push({
        id: `user-${i}`,
        rank: i,
        userName: 'Yedhu krishnan',
        totalDuration: '14 h 32 min',
        badges: 12,
        isCurrentUser: true,
      });
    } else {
      entries.push({
        id: `user-${i}`,
        rank: i,
        userName: names[(i - 1) % names.length],
        totalDuration: `${Math.floor(Math.random() * 20) + 5} h ${Math.floor(Math.random() * 60)} min`,
        badges: Math.floor(Math.random() * 30) + 10,
      });
    }
  }

  // If current user rank > 10, replace last entry with user's entry
  if (currentUserRank > 10) {
    entries[9] = {
      id: 'current-user',
      rank: currentUserRank,
      userName: 'Yedhu krishnan',
      totalDuration: '14 h 32 min',
      badges: 12,
      isCurrentUser: true,
    };
  }

  return entries;
};
