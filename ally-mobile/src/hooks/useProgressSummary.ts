import {USER_PERMISSIONS} from '@/constants';
import {
  useGetProgressEnabledQuery,
  useGetProgressSummaryQuery,
} from '@/services/progressApi';
import {useAppSelector} from '@/store/hooks';

/**
 * Single entry point for level/XP state across the app.
 *
 * Two gates, both required. The permission is what the API enforces on the data; the org
 * toggle decides whether this organisation has the feature at all. A permission-only
 * check would light the widget up for tenants that never opted in, because every learner
 * holds VIEW_USER_RANK.
 *
 * The summary endpoint takes no argument, so the header widget and the Progress screen
 * share one cache entry and one request no matter how many screens mount it.
 */
export const useProgressSummary = (options?: {skip?: boolean}) => {
  const permissions = useAppSelector(state => state.user.permissions);
  const hasPermission = Boolean(
    permissions?.includes(USER_PERMISSIONS.VIEW_USER_RANK),
  );

  const {data: isOrgEnabled, isLoading: isEnabledLoading} =
    useGetProgressEnabledQuery(undefined, {skip: Boolean(options?.skip)});

  const canViewProgress = hasPermission && Boolean(isOrgEnabled);

  const {data, isLoading, isError, refetch} = useGetProgressSummaryQuery(
    undefined,
    {skip: Boolean(options?.skip) || !canViewProgress},
  );

  return {
    summary: data,
    canViewProgress,
    // Still resolving whether the feature applies — callers render nothing rather than
    // flashing a widget that is about to disappear.
    isGateLoading: isEnabledLoading,
    isLoading,
    isError,
    refetchProgress: refetch,
  };
};
