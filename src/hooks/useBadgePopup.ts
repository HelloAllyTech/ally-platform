import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {getMockBadgesResponse} from '@/components/BadgePopup/mockData';
import {ViewedStatus} from '@/constants';
import {useGetBadgesQuery, useMarkBadgeAsViewedMutation} from '@/services';
import {GetBadgesResponse, UserBadge} from '@/types';

const USE_MOCK_DATA = true;

export const useBadgePopup = (autoCloseDelay: number | null = 5000) => {
  const [currentBadge, setCurrentBadge] = useState<UserBadge | null>(null);
  const [badgeQueue, setBadgeQueue] = useState<UserBadge[]>([]);
  const [isFirstBadge, setIsFirstBadge] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const clearBadgeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownFirstBadgeRef = useRef(false);

  const apiResult = useGetBadgesQuery(ViewedStatus.UNVIEWED, {
    skip: USE_MOCK_DATA,
  });
  const [markBadgeAsViewed] = useMarkBadgeAsViewedMutation();

  // Memoize mock badges to prevent recreating on every render
  const mockBadges = useMemo(
    () =>
      USE_MOCK_DATA ? getMockBadgesResponse(ViewedStatus.UNVIEWED) : undefined,
    [],
  );

  // Get badges from mock or API
  const badges: GetBadgesResponse | undefined = USE_MOCK_DATA
    ? mockBadges
    : apiResult.data;

  const isBadgesLoading = USE_MOCK_DATA ? false : apiResult.isLoading;

  useEffect(() => {
    if (badges?.data && !currentBadge) {
      const [firstBadge, ...rest] = badges?.data;
      const timeoutId = setTimeout(() => {
        setCurrentBadge(firstBadge);
        const isFirstEver = !hasShownFirstBadgeRef.current;
        setIsFirstBadge(isFirstEver);
        hasShownFirstBadgeRef.current = true;
        setBadgeQueue(rest);
      }, 1000);

      return () => {
        clearTimeout(timeoutId);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges?.data]);

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
  useEffect(() => {
    if (!currentBadge && badgeQueue.length > 0) {
      // Clear any pending clearBadge timeout to prevent it from clearing the next badge
      if (clearBadgeTimeoutRef.current) {
        clearTimeout(clearBadgeTimeoutRef.current);
        clearBadgeTimeoutRef.current = null;
      }

      // Small delay to ensure previous badge close animation completes
      const timeoutId = setTimeout(() => {
        // Double-check that we're still not visible and have badges in queue
        if (badgeQueue.length > 0) {
          const nextBadge = badgeQueue[0];
          setBadgeQueue(prev => prev.slice(1));
          setCurrentBadge(nextBadge);
          setIsFirstBadge(false);
        }
      }, 350); // Slightly longer than the 300ms delay in handleClose

      return () => {
        clearTimeout(timeoutId);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBadge]);

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
    if (currentBadge && !USE_MOCK_DATA) {
      try {
        await markBadgeAsViewed(currentBadge.id).unwrap();
      } catch (error) {
        console.error('Failed to mark badge as viewed:', error);
      }
    }
    // Clear badge after animation completes (optional delay)
    clearBadgeTimeoutRef.current = setTimeout(() => {
      setCurrentBadge(null);
      clearBadgeTimeoutRef.current = null;
    }, 300);
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

    // Set new timer with a small delay to ensure state is stable
    timerRef.current = setTimeout(() => {
      handleClose();
    }, autoCloseDelay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentBadge, autoCloseDelay, handleClose]);

  return {
    isBadgesLoading,
    currentBadge,
    isFirstBadge,
    closeBadge: handleClose,
  };
};
