import {ReactionSummary} from '@/hooks/useReactions';

export interface ReactionsBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  reviewId: string | number | null;
}

export interface ReactionFilterTabsProps {
  summary: ReactionSummary[];
  selectedReaction: string | null;
  totalCount: number;
  onFilterChange: (reaction: string | null) => void;
}

export interface ReactionUser {
  id: string | number;
  name: string;
  profileImage?: string | null;
}

export interface ReactionData {
  reaction: string;
  createdBy: ReactionUser;
}

export interface ReactionListItemProps {
  item: ReactionData;
}
