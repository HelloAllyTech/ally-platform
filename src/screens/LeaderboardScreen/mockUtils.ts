import {LeaderboardEntry} from '@/types/leaderboard';

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

export interface LeaderboardEntryWithCurrentUser extends LeaderboardEntry {
  isCurrentUser?: boolean;
}

export const generateMockLeaderboardData = (
  currentUserRank: number,
  currentUserId: number = 999,
  currentUserName: string = 'Yedhu Krishnan',
): LeaderboardEntryWithCurrentUser[] => {
  const entries: LeaderboardEntryWithCurrentUser[] = [];

  for (let rank = 1; rank <= TOTAL_ENTRIES; rank++) {
    if (rank === currentUserRank) {
      entries.push({
        userId: currentUserId,
        rank,
        name: currentUserName,
        profileImageUrl: '',
        minutesPlayed: 872, // 14 h 32 min = 872 minutes
        badgeCount: 12,
        isCurrentUser: true,
      });
    } else {
      entries.push({
        userId: rank,
        rank,
        name: NAMES[(rank - 1) % NAMES.length],
        profileImageUrl: '',
        minutesPlayed: Math.floor(Math.random() * 1000) + 300, // 5h to 21h
        badgeCount: Math.floor(Math.random() * 30) + 5,
      });
    }
  }

  return entries;
};
