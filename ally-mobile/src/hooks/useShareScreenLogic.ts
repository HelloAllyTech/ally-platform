import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {type EmojiType} from 'rn-emoji-keyboard';

import {useToast} from '@/components';

import {useAppNavigation} from './useAppNavigation';

const MAX_NOTE_LENGTH = 250;

interface UseShareScreenLogicParams {
  reviewId?: string;
  isEditNote?: boolean;
  initialNote?: string;
  shareTitle?: string;
  onCreateReview: (note: string) => Promise<{id?: string} | void>;
  onUpdateStatus: (reviewId: string, note: string) => Promise<void>;
  onShareSuccess?: (result?: {id?: string} | void) => void;
}

export const useShareScreenLogic = ({
  reviewId,
  isEditNote,
  initialNote,
  shareTitle,
  onCreateReview,
  onUpdateStatus,
  onShareSuccess,
}: UseShareScreenLogicParams) => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const {showToast} = useToast();

  const [note, setNote] = useState<string>('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  useEffect(() => {
    if (initialNote) {
      setNote(initialNote);
    }
  }, [initialNote]);

  const handleEmojiSelected = useCallback(
    (emoji: EmojiType) => {
      setNote(prev => {
        if (Array.from(prev).length < MAX_NOTE_LENGTH) {
          return prev + emoji.emoji;
        }
        return prev;
      });
    },
    [setNote],
  );

  const handleShare = useCallback(async () => {
    try {
      if (reviewId) {
        await onUpdateStatus(reviewId, note);
      } else {
        const result = await onCreateReview(note);
        showToast(t('callFeedback.sharedForReview'), 'success');
        if (onShareSuccess) {
          onShareSuccess(result);
        } else {
          navigation.goBack();
        }
        return;
      }

      showToast(t('callFeedback.sharedForReview'), 'success');
      navigation.goBack();
    } catch (error) {
      console.error('Error sharing for review:', error);
      const serverMessage = (error as {data?: {message?: string}})?.data
        ?.message;
      showToast(
        serverMessage || t('callFeedback.issues.editNoteExpired'),
        'error',
      );
      if (serverMessage) {
        navigation.goBack();
      }
    }
  }, [
    reviewId,
    onCreateReview,
    onUpdateStatus,
    onShareSuccess,
    showToast,
    t,
    navigation,
    note,
  ]);

  const handleEditNote = useCallback(async () => {
    if (!reviewId) return;
    try {
      await onUpdateStatus(reviewId, note);
      showToast(t('callFeedback.editNoteSuccess'), 'success');
      navigation.goBack();
    } catch (error) {
      console.error('Error editing note:', error);
      const serverMessage = (error as {data?: {message?: string}})?.data
        ?.message;
      showToast(
        serverMessage || t('callFeedback.issues.editNoteExpired'),
        'error',
      );
      if (serverMessage) {
        navigation.goBack();
      }
    }
  }, [reviewId, onUpdateStatus, note, navigation, showToast, t]);

  const screenTitle = isEditNote
    ? t('review.details.editNote')
    : shareTitle || t('simulationPage.shareScreenTitle');

  const buttonLabel = isEditNote ? t('common.save') : t('common.share');

  const onSubmit = isEditNote ? handleEditNote : handleShare;

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  return {
    note,
    setNote,
    onSubmit,
    screenTitle,
    buttonLabel,
    isEmojiPickerOpen,
    setIsEmojiPickerOpen,
    handleEmojiSelected,
    goBack,
    maxNoteLength: MAX_NOTE_LENGTH,
  };
};
