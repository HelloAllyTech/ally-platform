import React, {useCallback} from 'react';

import {ConfirmationModal, useErrorToast} from '@/components';
import {useTranslate} from '@/hooks';

interface ArchiveActionModalProps {
  visible: boolean;
  onClose: () => void;
  actionType: 'archive' | 'unarchive' | null;
  setActionType: (actionType: 'archive' | 'unarchive' | null) => void;
  onArchive: (archive: boolean) => void;
}

export const ArchiveActionModal = React.memo(
  ({
    visible,
    onClose,
    actionType,
    setActionType,
    onArchive,
  }: ArchiveActionModalProps) => {
    const {t} = useTranslate();
    const {showErrorToast} = useErrorToast();

    const isArchive = actionType === 'archive';
    const key = isArchive ? 'archive' : 'unarchive';

    const onConfirm = useCallback(async () => {
      try {
        await onArchive(isArchive);
        setActionType(isArchive ? 'unarchive' : 'archive');
      } catch (error) {
        showErrorToast(error, `CallSummary.archiveActionModal.${key}.failed`);
      } finally {
        onClose();
      }
    }, [isArchive, key, onClose, onArchive, showErrorToast, setActionType]);

    return (
      <ConfirmationModal
        visible={visible}
        onClose={onClose}
        onConfirm={onConfirm}
        title={t(`CallSummary.archiveActionModal.${key}.header.title`)}
        subtitle={t(`CallSummary.archiveActionModal.${key}.header.subtitle`)}
        description={t(`CallSummary.archiveActionModal.${key}.description`)}
        confirmLabel={t(`CallSummary.archiveActionModal.${key}.confirm`)}
        cancelLabel={t(`CallSummary.archiveActionModal.${key}.cancel`)}
        confirmVariant={isArchive ? 'destructive' : 'primary'}
      />
    );
  },
);
