import {useCallback, useEffect, useState} from 'react';

import {useLazyGetCallSummaryQuery} from '@/services/callSummaryApi';
import {useUpdateNotesMutation} from '@/services/chatApi';
import {useAppDispatch} from '@/store/hooks';
import {clearSummaryStates} from '@/store/slices/summarySlice';
import {logger} from '@/utils';

import {useDebounce} from './useDebounce';

type ModalType = 'rename' | 'delete' | null;

export const useSummaryState = (
  chatId: number | undefined,
  callId: number | undefined,
) => {
  const dispatch = useAppDispatch();
  const [fetchCallSummary, {isLoading, data: summaryData}] =
    useLazyGetCallSummaryQuery();
  const [updateNotes] = useUpdateNotesMutation();

  const [showSummary, setShowSummary] = useState(true);
  const [canShowSummary, setCanShowSummary] = useState(Boolean(callId));
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isSummaryAvailable, setIsSummaryAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isPollingComplete, setIsPollingComplete] = useState(false);

  // Initial polling logic
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    let pollCount = 0;
    const maxPolls = 5; // 5 additional polls after initial call (25 seconds total)

    const poll = async () => {
      if (!chatId) return;
      await fetchCallSummary(chatId);
    };

    // On mount, fetch summary
    poll();

    // Start polling every 5 seconds for up to 25 seconds
    pollInterval = setInterval(async () => {
      if (pollCount >= maxPolls) {
        if (pollInterval) clearInterval(pollInterval);
        setIsPollingComplete(true); // Mark polling as complete
        return;
      }
      pollCount++;
      await poll();
    }, 5000);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [chatId, fetchCallSummary]);

  useEffect(() => {
    if (summaryData?.details?.summary) {
      setIsSummaryAvailable(true);
    }
  }, [summaryData]);

  // After the summary becomes available, keep showing loader for 3 seconds,
  // then reveal the summary content automatically.
  useEffect(() => {
    if (!isSummaryAvailable || canShowSummary) return;
    const id = setTimeout(() => setCanShowSummary(true), 3000);
    return () => clearTimeout(id);
  }, [isSummaryAvailable, canShowSummary]);

  useEffect(() => {
    return () => {
      dispatch(clearSummaryStates());
    };
  }, [dispatch]);

  const handleRefresh = useCallback(async () => {
    if (!chatId) return;
    setRefreshing(true);
    await fetchCallSummary(chatId);
    setRefreshing(false);
  }, [chatId, fetchCallSummary]);

  const handleNoteChange = useDebounce(
    (text: string) => {
      if (!chatId) return;

      updateNotes({
        chatId,
        notes: {
          content: text,
        },
      }).catch(error => {
        logger.error(`Error updating notes: ${error}`);
      });
    },
    {delay: 1000},
  );

  return {
    isLoading,
    summaryData,
    showSummary,
    setShowSummary,
    canShowSummary,
    setCanShowSummary,
    activeModal,
    setActiveModal,
    showScrollToBottom,
    setShowScrollToBottom,
    isSummaryAvailable,
    refreshing,
    isPollingComplete,
    handleRefresh,
    handleNoteChange,
    summaryStatus: summaryData?.summaryStatus,
  };
};
