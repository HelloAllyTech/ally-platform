import {SvgProps} from 'react-native-svg';

import {Rank1Icon, Rank2Icon, Rank3Icon} from '@/assets/icons';

export const RANK_ICON_MAP: Record<number, React.FC<SvgProps>> = {
  1: Rank1Icon,
  2: Rank2Icon,
  3: Rank3Icon,
};

export enum LeaderboardPeriod {
  LAST_WEEK = 'last_week',
  LAST_MONTH = 'last_month',
  LAST_YEAR = 'last_year',
  ALL_TIME = 'all_time',
}
