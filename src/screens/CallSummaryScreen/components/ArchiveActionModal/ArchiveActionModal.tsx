import React, {useCallback} from 'react';

import {ConfirmationModal} from '@/components';
import {useTranslate} from '@/hooks';

interface ArchiveActionModalProps {
  visible: boolean;
  onClose: () => void;
  actionType: 'archive' | 'unarchive' | null;
  onArchive: (archive: boolean) => void;
}

export const ArchiveActionModal = React.memo(
  ({visible, onClose, actionType, onArchive}: ArchiveActionModalProps) => {
    const {t} = useTranslate();

    const isArchive = actionType === 'archive';
    const key = isArchive ? 'archive' : 'unarchive';

    const onConfirm = useCallback(async () => {
      await onArchive(isArchive);
      onClose();
    }, [isArchive, onClose, onArchive]);

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
