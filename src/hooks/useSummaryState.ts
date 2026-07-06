import {useCallback, useEffect, useRef, useState} from 'react';

import {ChatSummaryStatus} from '@/constants';
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
  const [
    fetchCallSummary,
    {isLoading, data: summaryData, error: summaryError},
  ] = useLazyGetCallSummaryQuery();
  const [updateNotes] = useUpdateNotesMutation();

  const [showSummary, setShowSummary] = useState(true);
  const [canShowSummary, setCanShowSummary] = useState(Boolean(callId));
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isSummaryAvailable, setIsSummaryAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [shouldShowFeedbackPopup, setShouldShowFeedbackPopup] = useState(false);
  const [isEndReached, setIsEndReached] = useState(false);
  const [isTranscriptAvailable, setIsTranscriptAvailable] = useState(false);

  useEffect(() => {
    const fetchSummary = async () => {
      if (!chatId) return;
      await fetchCallSummary(chatId);
    };
    fetchSummary();
  }, [chatId, fetchCallSummary]);

  useEffect(() => {
    if (summaryData?.details?.summary) {
      setIsSummaryAvailable(true);
    }
  }, [summaryData]);

  useEffect(() => {
    if (summaryData?.details?.transcript) {
      setIsTranscriptAvailable(true);
    }
  }, [summaryData?.details?.transcript]);

  // A manual scribe note is created as an already-ended DICTATION chat with
  // summaryStatus SUCCESS but no AI summary — the counsellor fills the fields
  // by hand (or via voice dictation). Latched for the screen's lifetime so the
  // note keeps its manual-note behaviour (no AI-feedback prompts) even after
  // the first save makes a summary object exist.
  const isManualNoteRef = useRef(false);
  if (
    summaryData?.summaryStatus === ChatSummaryStatus.SUCCESS &&
    !summaryData?.details?.summary
  ) {
    isManualNoteRef.current = true;
  }
  const isManualNote = isManualNoteRef.current;

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
    summaryError,
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
    handleRefresh,
    handleNoteChange,
    shouldShowFeedbackPopup,
    setShouldShowFeedbackPopup,
    isEndReached,
    setIsEndReached,
    summaryStatus: summaryData?.summaryStatus,
    isTranscriptAvailable,
    isManualNote,
  };
};
