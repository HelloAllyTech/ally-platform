import {USER_PERMISSIONS} from '@/constants';
import {useAppSelector} from '@/store/hooks';

/**
 * Whether this account is an evaluator, and so should be asked the evaluation
 * questions attached to the screen or event at hand.
 *
 * Reads the permission rather than the role: EVALUATOR is additive, so an
 * evaluator always holds a second app role, and the single `user.role` the
 * backend sends collapses those to one name by a priority list EVALUATOR is not
 * in. False while permissions are still loading, which is the right default —
 * an evaluation question that flashes in late is better than one shown to
 * someone who never opted in.
 */
export const useIsEvaluator = (): boolean => {
  const permissions = useAppSelector(state => state.user.permissions);

  return Boolean(permissions?.includes(USER_PERMISSIONS.EVALUATOR_ACCESS));
};
