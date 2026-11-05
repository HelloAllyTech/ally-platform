import React from 'react';
import {useTranslation} from 'react-i18next';
import {Linking} from 'react-native';

import {
  ArchiveIcon,
  ContractIcon,
  EditIcon,
  ExportIcon,
  UnarchiveIcon,
} from '@/assets';
import {FeedbackPopup} from '@/components';
import {PRIVACY_POLICY_URL} from '@/constants';

import {CustomMenuModalOption} from '../CustomMenuModal/CustomMenuModal';
import {ArchiveActionModal, CustomMenuModal, DeleteRenameModal} from '../index';

type ModalType = 'rename' | 'delete' | null;

interface SummaryModalsProps {
  activeModal: ModalType;
  setActiveModal: (modal: ModalType) => void;
  handleDelete: () => void;
  handleBlur: () => void;
  editedName: string;
  setEditedName: (name: string) => void;
  isMenuVisible: boolean;
  hideMenu: () => void;
  handleExport: () => void;
  actionType: 'archive' | 'unarchive' | null;
  showArchiveConfirmation: boolean;
  setShowArchiveConfirmation: (show: boolean) => void;
  onArchive: (archive: boolean) => void;
  showExportOption?: boolean;
  isSummaryFeedbackPopup?: boolean;
  hideSummaryFeedbackPopup: () => void;
  onSubmitSummaryFeedback: (feedback: {
    rating: number;
    issues: string[];
    comment: string;
    tags: string[];
  }) => void;
}

export const SummaryModals: React.FC<SummaryModalsProps> = ({
  activeModal,
  setActiveModal,
  handleDelete,
  handleBlur,
  editedName,
  setEditedName,
  isMenuVisible,
  hideMenu,
  handleExport,
  actionType,
  showArchiveConfirmation,
  setShowArchiveConfirmation,
  onArchive,
  showExportOption = false,
  isSummaryFeedbackPopup = false,
  hideSummaryFeedbackPopup,
  onSubmitSummaryFeedback,
}) => {
  const {t} = useTranslation();

  const customMenuOptions: CustomMenuModalOption[] = [
    {
      label: t('callSummary.info.rename'),
      iconRight: <EditIcon width={16} height={16} />,
      onPress: () => {
        setActiveModal('rename');
        hideMenu();
      },
    },
    ...(showExportOption
      ? [
          {
            label: t('callSummary.customMenu.export'),
            iconRight: <ExportIcon width={16} height={16} />,
            onPress: handleExport,
          },
        ]
      : []),
    {
      label: t('callSummary.customMenu.dataPolicy'),
      iconRight: <ContractIcon width={16} height={16} />,
      onPress: () => Linking.openURL(PRIVACY_POLICY_URL),
    },
    {
      label:
        actionType === 'archive'
          ? t(`callSummary.customMenu.archive`)
          : t(`callSummary.customMenu.unarchive`),
      iconRight:
        actionType === 'archive' ? (
          <ArchiveIcon width={16} height={16} />
        ) : (
          <UnarchiveIcon width={16} height={16} />
        ),
      onPress: () => setShowArchiveConfirmation(true),
    },
  ];
  return (
    <>
      <DeleteRenameModal
        activeModal={activeModal || ''}
        setActiveModal={modal => setActiveModal(modal as ModalType)}
        handleDelete={handleDelete}
        handleBlur={handleBlur}
        editedName={editedName}
        setEditedName={setEditedName}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={hideMenu}
        options={customMenuOptions}
      />
      <FeedbackPopup
        note={t('callFeedback.rateSubtitle')}
        visible={isSummaryFeedbackPopup}
        onClose={hideSummaryFeedbackPopup}
        onSubmit={onSubmitSummaryFeedback}
      />
      {actionType && (
        <ArchiveActionModal
          visible={showArchiveConfirmation}
          onClose={() => setShowArchiveConfirmation(false)}
          actionType={actionType}
          onArchive={onArchive}
        />
      )}
    </>
  );
};
