import {USER_PERMISSIONS} from '@/constants';
import {useGetScribeVoiceNoteEnabledQuery} from '@/services/settingsApi';
import {useAppSelector} from '@/store/hooks';

/**
 * Wraps `useGetScribeVoiceNoteEnabledQuery` with a permission guard.
 *
 * The `/settings/scribe-voice-note-enabled` endpoint is only authorized for
 * counsellors; calling it without the counsellor permission returns a 403.
 * This hook skips the request entirely unless the current user holds
 * `COUNSELOR_ACCESS`, and still honours an explicit caller-provided `skip`.
 */
export const useScribeVoiceNoteEnabled = (options?: {skip?: boolean}) => {
  const permissions = useAppSelector(state => state.user.permissions);
  const isCounsellor = Boolean(
    permissions?.includes(USER_PERMISSIONS.COUNSELOR_ACCESS),
  );

  return useGetScribeVoiceNoteEnabledQuery(undefined, {
    skip: Boolean(options?.skip) || !isCounsellor,
  });
};
