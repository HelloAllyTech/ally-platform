export interface SessionRatingTriggerProps {
  value: number;
  onSelect?: (rating: number) => void;
  size?: 'sm' | 'md';
}
