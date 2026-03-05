import {useCallback, useEffect, useRef, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useSelector} from 'react-redux';

import {
  BADGE_AUTO_CLOSE_DELAY,
  BADGE_CLOSE_ANIMATION_DELAY,
  BADGE_INITIAL_SHOW_DELAY,
  BADGE_NEXT_BADGE_DELAY,
  BADGE_POLLING_INTERVAL,
  ViewedStatus,
} from '@/constants';
import {USER_PERMISSIONS} from '@/constants/permissions';
import {useGetBadgesQuery, useMarkBadgeAsViewedMutation} from '@/services';
import {AppRootState} from '@/store/store';
import {UserBadge} from '@/types';
import {logger} from '@/utils';

export const useBadgePopup = (
  isLayoutReady: boolean = false,
  autoCloseDelay: number | null = BADGE_AUTO_CLOSE_DELAY,
) => {
  const isFocused = useIsFocused();
  const [currentBadge, setCurrentBadge] = useState<UserBadge | null>(null);
  const [badgeQueue, setBadgeQueue] = useState<UserBadge[]>([]);
  const [isFirstBadge, setIsFirstBadge] = useState(false);
  const isProcessingQueueRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const clearBadgeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownFirstBadgeRef = useRef(false);

  const permissions = useSelector(
    (state: AppRootState) => state.user.permissions,
  );
  const hasViewBadgesPermission = permissions.includes(
    USER_PERMISSIONS.VIEW_USER_BADGES,
  );

  const {data: badges, isLoading: isBadgesLoading} = useGetBadgesQuery(
    {viewedStatus: ViewedStatus.UNVIEWED},
    {
      pollingInterval: BADGE_POLLING_INTERVAL,
      refetchOnFocus: true,
      refetchOnReconnect: true,
      skip: !hasViewBadgesPermission || !isFocused,
    },
  );
  const [markBadgeAsViewed] = useMarkBadgeAsViewedMutation();

  // Initial badge queue setup
  useEffect(() => {
    if (badges?.data?.length && !currentBadge) {
      const [firstBadge, ...rest] = badges.data;
      const timeoutId = setTimeout(() => {
        setCurrentBadge(firstBadge);
        const isFirstEver = !hasShownFirstBadgeRef.current;
        setIsFirstBadge(isFirstEver);
        hasShownFirstBadgeRef.current = true;
        setBadgeQueue(rest);
      }, BADGE_INITIAL_SHOW_DELAY);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [badges?.data, currentBadge]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (clearBadgeTimeoutRef.current) {
        clearTimeout(clearBadgeTimeoutRef.current);
      }
    };
  }, []);

  // Process the next badge in queue when current badge closes
  const processNextBadge = useCallback(() => {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;

    setBadgeQueue(currentQueue => {
      if (currentQueue.length === 0) {
        isProcessingQueueRef.current = false;
        return currentQueue;
      }

      const [nextBadge, ...rest] = currentQueue;

      // Small delay to ensure previous badge close animation completes
      setTimeout(() => {
        setCurrentBadge(nextBadge);
        setIsFirstBadge(false);
        isProcessingQueueRef.current = false;
      }, BADGE_NEXT_BADGE_DELAY);

      return rest;
    });
  }, []);

  useEffect(() => {
    if (!currentBadge && badgeQueue.length > 0) {
      // Clear any pending clearBadge timeout to prevent it from clearing the next badge
      if (clearBadgeTimeoutRef.current) {
        clearTimeout(clearBadgeTimeoutRef.current);
        clearBadgeTimeoutRef.current = null;
      }

      processNextBadge();
    }
  }, [currentBadge, badgeQueue.length, processNextBadge]);

  const handleClose = useCallback(async () => {
    // Clear auto-close timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Clear any pending clearBadge timeout
    if (clearBadgeTimeoutRef.current) {
      clearTimeout(clearBadgeTimeoutRef.current);
      clearBadgeTimeoutRef.current = null;
    }

    // Mark badge as viewed before clearing
    if (currentBadge) {
      try {
        await markBadgeAsViewed(currentBadge.badgeId).unwrap();
      } catch (error) {
        logger.error(`Failed to mark badge as viewed: ${error}`);
      }
    }

    // Clear badge after animation completes
    clearBadgeTimeoutRef.current = setTimeout(() => {
      setCurrentBadge(null);
      clearBadgeTimeoutRef.current = null;
    }, BADGE_CLOSE_ANIMATION_DELAY);
  }, [currentBadge, markBadgeAsViewed]);

  // Handle auto-close timer
  useEffect(() => {
    if (!currentBadge) {
      // Clear timer when badge is not visible or doesn't exist
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // If auto-close is disabled (null or 0), don't set timer
    if (autoCloseDelay === null || autoCloseDelay <= 0) {
      return;
    }

    // Clear any existing timer first
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Set new timer
    if (isLayoutReady) {
      timerRef.current = setTimeout(() => {
        handleClose();
      }, autoCloseDelay);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentBadge, autoCloseDelay, handleClose, isLayoutReady]);

  return {
    isBadgesLoading,
    currentBadge,
    isFirstBadge,
    closeBadge: handleClose,
  };
};
