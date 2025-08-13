import {useCallback, useEffect, useState} from 'react';

import {useLazyGetCallSummaryQuery} from '@/services/callSummaryApi';
import {useUpdateNotesMutation} from '@/services/chatApi';
import {useAppDispatch} from '@/store/hooks';
import {clearSummaryStates} from '@/store/slices/summarySlice';

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

  const [isFullyExpanded, setIsFullyExpanded] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [canShowSummary, setCanShowSummary] = useState(Boolean(callId));
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showAnimation, setShowAnimation] = useState(!chatId);
  const [isSummaryAvailable, setIsSummaryAvailable] = useState(false);
  const [hasCollapsedBeenShown, setHasCollapsedBeenShown] = useState(false);
  const [forceRemountKey, setForceRemountKey] = useState(0);
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

  // Watch for summaryData changes
  useEffect(() => {
    if (summaryData?.details?.summary) {
      setIsSummaryAvailable(true);
    }
  }, [summaryData]);

  // Cleanup summary state on unmount
  useEffect(() => {
    return () => {
      dispatch(clearSummaryStates());
    };
  }, [dispatch]);

  useEffect(() => {
    if (hasCollapsedBeenShown && showAnimation) {
      setShowAnimation(false);
      setForceRemountKey(prev => prev + 1);
    }
  }, [hasCollapsedBeenShown, showAnimation]);

  const handleScroll = useCallback(
    (isExpanded: boolean) => {
      setIsFullyExpanded(isExpanded);
      if (showAnimation && !isExpanded && !hasCollapsedBeenShown) {
        setHasCollapsedBeenShown(true);
      }
      return !isExpanded;
    },
    [showAnimation, hasCollapsedBeenShown],
  );

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
        // Handle error if needed
      });
    },
    {delay: 1000},
  );

  return {
    isLoading,
    summaryData,
    isFullyExpanded,
    showSummary,
    setShowSummary,
    showInfoModal,
    setShowInfoModal,
    canShowSummary,
    setCanShowSummary,
    activeModal,
    setActiveModal,
    showScrollToBottom,
    setShowScrollToBottom,
    showAnimation,
    isSummaryAvailable,
    forceRemountKey,
    refreshing,
    isPollingComplete,
    handleScroll,
    handleRefresh,
    handleNoteChange,
  };
};
