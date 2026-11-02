import {MutableRefObject, useCallback, useEffect, useRef} from 'react';
import {
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  View,
} from 'react-native';

import {
  useMarkDebriefOpenedMutation,
  useMarkDebriefReadMutation,
} from '@/services/learnerDebriefApi';

/** The debrief must have been open this long (v9 FR-65). */
export const READ_MIN_OPEN_MS = 30_000;

/**
 * DEBRIEF_READ XP — mirrors ally-web's useReadToTheEnd: once the end of the
 * last Work-on-this card has been on screen and the debrief has been open for
 * 30 seconds, tell the server — at most once per mount; the server pays at
 * most once per session anyway. Opening and immediately closing earns nothing.
 *
 * RN has no IntersectionObserver, so "on screen" is worked out from the
 * ScrollView: the marker's offset inside the scroll content (measured against
 * `contentRef`) against how far the learner has scrolled plus the viewport.
 */
export const useReadToTheEnd = (sessionId: string, enabled: boolean) => {
  const [markRead] = useMarkDebriefReadMutation();
  const sent = useRef(false);
  const seen = useRef(false);
  const longEnough = useRef(false);
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const endY = useRef<number | null>(null);
  const contentRef = useRef<View>(null);
  const endRef = useRef<View>(null);

  const maybeSend = useCallback(() => {
    if (seen.current && longEnough.current && !sent.current) {
      sent.current = true;
      markRead(sessionId);
    }
  }, [markRead, sessionId]);

  const check = useCallback(() => {
    if (
      endY.current !== null &&
      viewportHeight.current > 0 &&
      scrollY.current + viewportHeight.current >= endY.current
    ) {
      seen.current = true;
      maybeSend();
    }
  }, [maybeSend]);

  /** Where the end marker sits in the scroll content; re-asked on any resize. */
  const measureEnd = useCallback(() => {
    const marker = endRef.current;
    const content = contentRef.current;
    if (!marker || !content) {
      endY.current = null;
      return;
    }
    marker.measureLayout(
      content,
      (_x, y, _w, h) => {
        endY.current = y + h;
        check();
      },
      () => {},
    );
  }, [check]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const timer = setTimeout(() => {
      longEnough.current = true;
      maybeSend();
    }, READ_MIN_OPEN_MS);
    return () => clearTimeout(timer);
  }, [enabled, maybeSend]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      check();
    },
    [check],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewportHeight.current = e.nativeEvent.layout.height;
      check();
    },
    [check],
  );

  return {
    contentRef,
    endRef,
    /** For the end marker's `onLayout`, and the content's size changes. */
    measureEnd,
    /** For the ScrollView. */
    scrollProps: {onScroll, onLayout, scrollEventThrottle: 100},
  };
};

/** v9 FR-31: "opened" is the ready debrief in the foreground for 2 s. */
export const OPENED_AFTER_MS = 2000;

/**
 * Tells the server, once, that the learner opened their debrief — mirrors
 * ally-web's useMarkOpened, with AppState for page visibility: the 2 s start
 * over whenever the app comes back to the foreground. `sent` can be owned by
 * the caller so a remount (e.g. the distress panel collapsed and reopened)
 * still never sends twice in one visit. Errors are ignored.
 */
export const useMarkOpened = (
  sessionId: string,
  enabled: boolean,
  sentRef?: MutableRefObject<boolean>,
) => {
  const [markOpened] = useMarkDebriefOpenedMutation();
  const ownSent = useRef(false);
  const sent = sentRef ?? ownSent;
  useEffect(() => {
    if (!enabled || sent.current) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (state: AppStateStatus) => {
      clearTimeout(timer);
      timer = undefined;
      if (state !== 'active' || sent.current) {
        return;
      }
      timer = setTimeout(() => {
        sent.current = true;
        markOpened(sessionId);
      }, OPENED_AFTER_MS);
    };
    arm(AppState.currentState);
    const subscription = AppState.addEventListener('change', arm);
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [enabled, markOpened, sessionId, sent]);
};
