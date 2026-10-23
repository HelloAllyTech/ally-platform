import {SvgProps} from 'react-native-svg';

import {Rank1Icon, Rank2Icon, Rank3Icon} from '@/assets/icons';

export const LEADERBOARD_FETCH_LIMIT = 30;
export const LEADERBOARD_NOTIFICATION_ID = 'weekly-leaderboard';
export const LEADERBOARD_CHANNEL_ID = 'leaderboard';
export const RANK_ICON_MAP: Record<number, React.FC<SvgProps>> = {
  1: Rank1Icon,
  2: Rank2Icon,
  3: Rank3Icon,
};

export enum LeaderboardPeriod {
  LAST_WEEK = 'LAST_WEEK',
  LAST_MONTH = 'LAST_MONTH',
  LAST_YEAR = 'LAST_YEAR',
  ALL_TIME = 'ALL_TIME',
}
