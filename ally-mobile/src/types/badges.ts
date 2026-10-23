import {BadgeCategory, LockStatus, ViewedStatus} from '@/constants/badges';

export interface AchievementParams {
  count: number;
}

export interface Badge {
  id: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string;
  category: BadgeCategory;
  achievementParams: AchievementParams;
  viewedStatus: ViewedStatus;
  lockStatus: LockStatus;
}

export interface BadgeCategoryGroup {
  category: string;
  badges: Badge[];
}

export type BadgesResponse = BadgeCategoryGroup[];

export interface UserBadge {
  id: string;
  badgeId: string;
  userId: number;
  viewedStatus: ViewedStatus;
  createdAt: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string;
}

export interface GetBadgesResponse {
  data: UserBadge[];
}
