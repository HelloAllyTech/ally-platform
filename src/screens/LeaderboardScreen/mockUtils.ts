import {LeaderboardEntry} from './LeaderboardScreen';

const NAMES = [
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
  'Chris Martin',
  'Daniel Lee',
  'Sophia White',
  'Olivia Harris',
  'Noah Clark',
];

const TOTAL_ENTRIES = 50;

export const generateMockLeaderboardData = (
  currentUserRank: number,
): LeaderboardEntry[] => {
  const entries: LeaderboardEntry[] = [];

  for (let rank = 1; rank <= TOTAL_ENTRIES; rank++) {
    if (rank === currentUserRank) {
      entries.push({
        id: 'current-user',
        rank,
        userName: 'Yedhu Krishnan',
        totalDuration: '14 h 32 min',
        badges: 12,
        isCurrentUser: true,
      });
    } else {
      entries.push({
        id: `user-${rank}`,
        rank,
        userName: NAMES[(rank - 1) % NAMES.length],
        totalDuration: `${Math.floor(Math.random() * 20) + 5} h ${Math.floor(
          Math.random() * 60,
        )} min`,
        badges: Math.floor(Math.random() * 30) + 5,
      });
    }
  }

  return entries;
};
