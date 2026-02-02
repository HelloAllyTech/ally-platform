import {SortOrder} from '@/constants';

export interface LeaderboardEntry {
  userId: number;
  name: string;
  profileImageUrl: string;
  rank: number;
  minutesPlayed: number;
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
