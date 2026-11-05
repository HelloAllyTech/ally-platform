import {useCallback, useEffect, useState} from 'react';

import {useErrorToast, useToast} from '@/components';
import {useArchiveCallLogMutation} from '@/services';
import {
  useAddSummaryFeedbackMutation,
  useLazyExportCallSummaryQuery,
  useUpdateCallInfoMutation,
  useUpdateCallSummaryMutation,
} from '@/services/callSummaryApi';
import {useAppDispatch} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {saveFile} from '@/utils/fileOperations';
import {logger} from '@/utils/logger';

import {useAppNavigation} from './useAppNavigation';
import {useStoragePermissions} from './useStoragePermissions';
import {useTranslate} from './useTranslate';

export const useCallSummaryActions = ({
  chatId,
  name,
  isCallLogSummaryFlow,
  archived,
}: {
  chatId: number;
  name: string;
  isCallLogSummaryFlow: boolean;
  archived?: boolean;
}) => {
  const [updateCallInfo] = useUpdateCallInfoMutation();
  const [exportCallSummary] = useLazyExportCallSummaryQuery();
  const [updateCallSummary] = useUpdateCallSummaryMutation();
  const [addSummaryFeedback] = useAddSummaryFeedbackMutation();
  const [archiveCallLog] = useArchiveCallLogMutation();

  const navigation = useAppNavigation();
  const dispatch = useAppDispatch();

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSummaryDropdownVisible, setIsSummaryDropdownVisible] =
    useState(false);
  const [summaryName, setSummaryName] = useState(name);
  const [isArchived, setIsArchived] = useState(false);

  const [actionType, setActionType] = useState<'archive' | 'unarchive' | null>(
    null,
  );

  const {t} = useTranslate();
  const {showToast} = useToast();
  const {showErrorToast} = useErrorToast();

  useEffect(() => {
    setIsArchived(!!archived);
    setActionType(archived ? 'unarchive' : 'archive');
  }, [archived]);

  useEffect(() => {
    if (name) {
      setSummaryName(name);
    }
  }, [name]);

  const {checkAndRequestPermissions} = useStoragePermissions();

  // Hide rename, export, delete menu
  const hideMenu = () => {
    setIsMenuVisible(false);
  };

  // Show rename, export, delete menu
  const showMenu = () => {
    setIsMenuVisible(true);
  };

  // Update call summary name
  const handleSummaryNameChange = async (newName: string) => {
    if (chatId) {
      try {
        await updateCallInfo({
          chatId,
          summaryName: newName,
        }).unwrap();
        setSummaryName(newName);
        showToast(t('callSummary.info.summaryNameUpdateSuccess'), 'success');
      } catch (error) {
        showErrorToast(error, 'callSummary.info.summaryNameUpdateFailed');
      }
    }
  };

  // Export call summary
  const handleExport = async () => {
    if (!chatId) return;

    try {
      const hasPermission = await checkAndRequestPermissions();
      if (!hasPermission) return;

      const response = await exportCallSummary(chatId).unwrap();
      if (typeof response !== 'string') {
        throw new Error(t('callSummary.info.invalidResponseFormat'));
      }

      const filePath = await saveFile({
        content: response,
        chatId,
        t,
      });
      logger.info(t('callSummary.info.fileSavedSuccess', {path: filePath}));

      showToast(t('callSummary.info.fileExportedSuccess'), 'success');
      setIsMenuVisible(false);
    } catch (error) {
      showErrorToast(error, 'callSummary.info.fileExportFailed');
    }
  };

  // Archive call summary
  const handleArchive = async (archive: boolean) => {
    try {
      await archiveCallLog({callLogId: chatId, archive}).unwrap();
      showToast(
        t(
          `callSummary.archiveActionModal.${archive ? 'archive' : 'unarchive'}.success`,
        ),
        'success',
      );
      setIsArchived(archive);
      setActionType(archive ? 'unarchive' : 'archive');
    } catch (error) {
      showErrorToast(
        error,
        t(
          `callSummary.archiveActionModal.${archive ? 'archive' : 'unarchive'}.failed`,
        ),
      );
    } finally {
      setIsMenuVisible(false);
    }
  };

  // Delete call summary
  const handleDelete = async () => {
    if (chatId) {
      try {
        const response = await updateCallSummary({
          chatId,
          data: {summary: {}},
        });
        showToast(t('callSummary.info.summaryDeletedSuccess'), 'success');
        setIsMenuVisible(false);
        if (response.data) {
          setTimeout(() => {
            navigation.goBack();
          }, 2000);
        } else {
          showToast(t('callSummary.info.summaryDeleteFailed'));
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('callSummary.info.summaryDeleteFailed');
        logger.error(errorMessage);
        showToast(errorMessage);
      }
    }
  };

  // Go back to Call Logs screen
  const handleGoBack = useCallback(() => {
    if (isCallLogSummaryFlow) {
      navigation.goBack();
    } else {
      navigation.reset({index: 0, routes: [{name: 'CallLog'}]});
      dispatch(clearCurrentChat());
    }
  }, [isCallLogSummaryFlow, navigation, dispatch]);

  // Update call summary
  const onUpdateSummary = useCallback(
    (isSuccess: boolean) => {
      if (isSuccess) {
        showToast(t('callSummary.info.summaryUpdatedSuccess'), 'success');
        setTimeout(() => {
          handleGoBack();
        }, 2000);
      } else {
        showToast(t('callSummary.info.summaryUpdateFailed'));
      }
    },
    [showToast, t, handleGoBack],
  );

  const onAddSummaryFeedback = useCallback(
    async (feedback: {
      rating: number;
      issues: string[];
      comment: string;
      tags: string[];
    }) => {
      const response = await addSummaryFeedback({
        chatId,
        rating: feedback.rating,
        feedback,
      });

      return response;
    },
    [addSummaryFeedback, chatId],
  );

  // Show summary, transcript dropdown
  const onHeaderPress = () => {
    setIsSummaryDropdownVisible(true);
  };

  // Hide summary, transcript dropdown
  const hideHeaderDropdown = () => {
    setIsSummaryDropdownVisible(false);
  };

  return {
    handleSummaryNameChange,
    onUpdateSummary,
    isMenuVisible,
    isArchived,
    actionType,
    hideMenu,
    showMenu,
    handleExport,
    handleArchive,
    handleDelete,
    handleGoBack,
    summaryName,
    setSummaryName,
    onHeaderPress,
    isSummaryDropdownVisible,
    hideHeaderDropdown,
    onAddSummaryFeedback,
  };
};
