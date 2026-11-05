import {SortOrder} from '@/constants';

export interface LeaderboardEntry {
  userId: number;
  name: string;
  profileImageUrl: string;
  rank: number;
  minutesPlayed: number;
  /** XP earned in the window — the value rank is ordered by. Absent on older APIs. */
  xpScore?: number;
  badgeCount: number;
}

export interface LeaderboardResponse {
  data: LeaderboardEntry[];
  window: string;
  totalCount: number;
}

export interface MyRankResponse {
  userId: number;
  name: string;
  profileImageUrl: string;
  rank: number;
  minutesPlayed: number;
  /** XP earned in the window — the value rank is ordered by. Absent on older APIs. */
  xpScore?: number;
  badgeCount: number;
  window: string;
  hideRankInCommunity: boolean;
}

export interface LeaderboardQueryParams {
  window: string;
  limit?: number;
  offset?: number;
  sortBy?: 'score' | 'minutesPlayed' | 'badgeCount';
  order?: SortOrder;
}
