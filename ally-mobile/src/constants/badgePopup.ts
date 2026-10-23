/**
 * Badge Popup timing constants
 */

// Default auto-close delay for badge popup (in milliseconds)
export const BADGE_AUTO_CLOSE_DELAY = 5000;

// Delay before showing the first badge after fetching (in milliseconds)
export const BADGE_INITIAL_SHOW_DELAY = 1000;

// Delay for badge close animation (in milliseconds)
export const BADGE_CLOSE_ANIMATION_DELAY = 300;

// Delay before showing next badge in queue (in milliseconds)
// Should be slightly longer than BADGE_CLOSE_ANIMATION_DELAY
export const BADGE_NEXT_BADGE_DELAY = 350;

// Polling interval for checking new badges (in milliseconds)
// Set to 1 minute
export const BADGE_POLLING_INTERVAL = 60000;
