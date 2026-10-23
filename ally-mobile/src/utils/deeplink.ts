import type {NavigationContainerRef} from '@react-navigation/native';

import {env} from '@/config/env';
import {SCREEN_NAMES} from '@/constants';
import type {RootStackParamList} from '@/navigation/types';

const ALLOWED_DEEPLINK_URLS = [env.ALLY_WEB_URL] as const;

/**
 * Paths the app opens. Each must also be claimed natively — the `paths` in the
 * web app's `.well-known/apple-app-site-association` (iOS) and a `pathPrefix`
 * on the autoVerify intent filter in AndroidManifest.xml — or the OS opens the
 * link in the browser and this code never sees it.
 */
const SUPPORTED_DEEPLINK_PATHS = ['/summary', '/course'] as const;

export const isSupportedDeepLink = (url: URL): boolean => {
  return (
    url.protocol === 'https:' &&
    ALLOWED_DEEPLINK_URLS.map(_url => new URL(_url).host).includes(url.host) &&
    SUPPORTED_DEEPLINK_PATHS.some(path => url.pathname.startsWith(path))
  );
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a course share link (`/course/...`), valid id or not. */
export const isCourseLink = (url: URL): boolean =>
  url.pathname.split('/').filter(Boolean)[0] === 'course';

/**
 * The course id in a course share link (`/course/:trackId`), or undefined when
 * the path is not one or the id is not a uuid.
 */
export const getCourseIdFromUrl = (url: URL): string | undefined => {
  const [segment, id] = url.pathname.split('/').filter(Boolean);
  if (segment !== 'course' || !id) return undefined;
  return UUID_PATTERN.test(id) ? id : undefined;
};

export const getCallIdFromUrl = (url: URL): number | undefined => {
  const parts = url.pathname.split('/').filter(Boolean); // ["summary", ":id"]
  const id = parts[1];
  if (!id) return undefined;
  const callId = Number(id);
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
