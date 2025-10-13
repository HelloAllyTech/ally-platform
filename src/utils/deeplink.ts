import type {NavigationContainerRef} from '@react-navigation/native';

import {env} from '@/config/env';
import {SCREEN_NAMES} from '@/constants';
import type {RootStackParamList} from '@/navigation/types';

const ALLOWED_DEEPLINK_URLS = [env.ALLY_WEB_URL] as const;

export const isSupportedDeepLink = (url: URL): boolean => {
  return (
    url.protocol === 'https:' &&
    ALLOWED_DEEPLINK_URLS.map(_url => new URL(_url).host).includes(url.host) &&
    url.pathname === '/open'
  );
};

export const getCallIdFromUrl = (url: URL): number | undefined => {
  const itemId = url.searchParams.get('itemId') ?? undefined;
  if (!itemId) return undefined;
  const callId = Number(itemId);
  return Number.isNaN(callId) ? undefined : callId;
};

export const navigateToCallSummaryOrLog = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
  callId?: number,
  fromLogs: boolean = true,
): void => {
  const canReset = Boolean(navigationRef?.getRootState?.());
  if (canReset) {
    navigationRef.reset({
      index: 1,
      routes: [
        {name: SCREEN_NAMES.CALL_LOG},
        {
          name: SCREEN_NAMES.CALL_SUMMARY,
          params: {callId, fromLogs},
        },
      ],
    });
    return;
  }
  navigationRef.navigate(SCREEN_NAMES.CALL_SUMMARY, {
    callId,
    fromLogs,
  });
  return;
};
