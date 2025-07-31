import {useCallback, useEffect, useState} from 'react';

import {
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
import useTranslate from './useTranslate';

interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'info';
}

const useCallSummaryActions = ({
  chatId,
  name,
  isCallLogSummaryFlow,
}: {
  chatId: number;
  name: string;
  isCallLogSummaryFlow: boolean;
}) => {
  const [updateCallInfo] = useUpdateCallInfoMutation();
  const [exportCallSummary] = useLazyExportCallSummaryQuery();
  const [updateCallSummary] = useUpdateCallSummaryMutation();

  const navigation = useAppNavigation();
  const dispatch = useAppDispatch();

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSummaryDropdownVisible, setIsSummaryDropdownVisible] =
    useState(false);
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'error',
  });
  const [summaryName, setSummaryName] = useState(name);

  const {t} = useTranslate();

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'error') => {
      setToast({
        visible: true,
        message,
        type,
      });
    },
    [],
  );

  const hideToast = useCallback(() => {
    setToast(prev => ({...prev, visible: false}));
  }, []);

  useEffect(() => {
    if (name) {
      setSummaryName(name);
    }
  }, [name]);

  const {checkAndRequestPermissions} = useStoragePermissions(showToast);

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
        showToast(t('CallSummary.info.summaryNameUpdateSuccess'), 'success');
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('CallSummary.info.summaryNameUpdateFailed');
        logger.error(errorMessage);
        showToast(errorMessage);
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
        throw new Error(t('CallSummary.info.invalidResponseFormat'));
      }

      const filePath = await saveFile({
        content: response,
        chatId,
        t,
      });
      logger.info(t('CallSummary.info.fileSavedSuccess', {path: filePath}));

      showToast(t('CallSummary.info.fileExportedSuccess'), 'success');
      setIsMenuVisible(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : t('CallSummary.info.fileExportFailed');
      logger.error(errorMessage);
      showToast(errorMessage);
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
        showToast(t('CallSummary.info.summaryDeletedSuccess'), 'success');
        setIsMenuVisible(false);
        if (response.data) {
          setTimeout(() => {
            navigation.goBack();
          }, 2000);
        } else {
          showToast(t('CallSummary.info.summaryDeleteFailed'));
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t('CallSummary.info.summaryDeleteFailed');
        logger.error(errorMessage);
        showToast(errorMessage);
      }
    }
  };

  // Go back to home screen
  const handleGoBack = useCallback(() => {
    if (isCallLogSummaryFlow) {
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{name: 'Home'}],
      });
      dispatch(clearCurrentChat());
    }
  }, [isCallLogSummaryFlow, navigation, dispatch]);

  // Update call summary
  const onUpdateSummary = useCallback(
    (isSuccess: boolean) => {
      if (isSuccess) {
        showToast(t('CallSummary.info.summaryUpdatedSuccess'), 'success');
        setTimeout(() => {
          handleGoBack();
        }, 2000);
      } else {
        showToast(t('CallSummary.info.summaryUpdateFailed'));
      }
    },
    [showToast, t, handleGoBack],
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
    hideMenu,
    showMenu,
    handleExport,
    handleDelete,
    handleGoBack,
    hideToast,
    showToast,
    toast,
    summaryName,
    setSummaryName,
    onHeaderPress,
    isSummaryDropdownVisible,
    hideHeaderDropdown,
  };
};

export default useCallSummaryActions;
