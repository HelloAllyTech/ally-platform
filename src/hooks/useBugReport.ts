import {useCallback, useState} from 'react';

import {useErrorToast, useToast} from '@/components';
import {MAX_BUG_REPORT_DESCRIPTION_LENGTH} from '@/constants';
import {useCreateBugReportMutation} from '@/services';
import {getBugReportContext} from '@/utils';

import {useTranslate} from './useTranslate';

const HTTP_TOO_MANY_REQUESTS = 429;

interface UseBugReportOptions {
  /** Current screen/route name, captured silently as diagnostic context. */
  screen?: string;
  onSuccess?: () => void;
}

interface UseBugReportReturn {
  description: string;
  setDescription: (value: string) => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  maxLength: number;
  handleSubmit: () => Promise<void>;
}

const isRateLimitError = (error: unknown): boolean => {
  const err = error as {status?: number};
  return err?.status === HTTP_TOO_MANY_REQUESTS;
};

/**
 * Drives the "Report a problem" screen: a single guided free-text field,
 * submitted with silently-captured diagnostic context. No retry/backoff — a
 * 429 (8/hour/user server-side) just surfaces a plain message.
 */
export const useBugReport = ({
  screen,
  onSuccess,
}: UseBugReportOptions): UseBugReportReturn => {
  const {t} = useTranslate();
  const {showToast} = useToast();
  const {showErrorToast} = useErrorToast();
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createBugReport] = useCreateBugReportMutation();

  const canSubmit =
    description.trim().length > 0 &&
    description.length <= MAX_BUG_REPORT_DESCRIPTION_LENGTH;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await createBugReport({
        description: description.trim(),
        context: getBugReportContext(screen),
      }).unwrap();

      showToast({
        message: t('bugReport.successMessage'),
        type: 'success',
      });
      setDescription('');
      onSuccess?.();
    } catch (error) {
      if (isRateLimitError(error)) {
        showToast({
          message: t('bugReport.rateLimitMessage'),
          type: 'error',
        });
      } else {
        showErrorToast(error, 'errors.submitBugReport');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    isSubmitting,
    createBugReport,
    description,
    screen,
    showToast,
    showErrorToast,
    t,
    onSuccess,
  ]);

  return {
    description,
    setDescription,
    isSubmitting,
    canSubmit,
    maxLength: MAX_BUG_REPORT_DESCRIPTION_LENGTH,
    handleSubmit,
  };
};
