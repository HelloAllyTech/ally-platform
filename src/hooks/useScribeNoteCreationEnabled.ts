import {USER_PERMISSIONS} from '@/constants';
import {useGetScribeNoteCreationEnabledQuery} from '@/services/settingsApi';
import {useAppSelector} from '@/store/hooks';

/**
 * Wraps `useGetScribeNoteCreationEnabledQuery` with a permission guard.
 *
 * The `/settings/scribe-note-creation-enabled` endpoint is only authorized for
 * counsellors; calling it without the counsellor permission returns a 403.
 * This hook skips the request entirely unless the current user holds
 * `COUNSELOR_ACCESS`, and still honours an explicit caller-provided `skip`.
 */
export const useScribeNoteCreationEnabled = (options?: {skip?: boolean}) => {
  const permissions = useAppSelector(state => state.user.permissions);
  const isCounsellor = Boolean(
    permissions?.includes(USER_PERMISSIONS.COUNSELOR_ACCESS),
  );

  return useGetScribeNoteCreationEnabledQuery(undefined, {
    skip: Boolean(options?.skip) || !isCounsellor,
  });
};
