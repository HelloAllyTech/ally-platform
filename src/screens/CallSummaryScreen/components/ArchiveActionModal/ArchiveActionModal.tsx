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
        title={t(`callSummary.archiveActionModal.${key}.header.title`)}
        subtitle={t(`callSummary.archiveActionModal.${key}.header.subtitle`)}
        description={t(`callSummary.archiveActionModal.${key}.description`)}
        confirmLabel={t(`callSummary.archiveActionModal.${key}.confirm`)}
        cancelLabel={t(`callSummary.archiveActionModal.${key}.cancel`)}
        confirmVariant={isArchive ? 'destructive' : 'primary'}
      />
    );
  },
);
