import React from 'react';
import {useTranslation} from 'react-i18next';

import {FeedbackPopup} from '@/components';

import {
  ArchiveActionModal,
  CustomMenuModal,
  DeleteRenameModal,
  SummaryDropdown,
} from '../index';

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
  isSummaryDropdownVisible: boolean;
  hideHeaderDropdown: () => void;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
  actionType: 'archive' | 'unarchive' | null;
  setActionType: (actionType: 'archive' | 'unarchive' | null) => void;
  showArchiveConfirmation: boolean;
  setShowArchiveConfirmation: (show: boolean) => void;
  onArchive: (archive: boolean) => void;
  showExportOption?: boolean;
  isSummaryFeedbackPopup?: boolean;
  hideSummaryFeedbackPopup: () => void;
  onSubmitSummaryFeedback: (
    rating: number,
    feedback: {issues: string[]; comment: string},
  ) => void;
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
  isSummaryDropdownVisible,
  hideHeaderDropdown,
  showSummary,
  setShowSummary,
  actionType,
  setActionType,
  showArchiveConfirmation,
  setShowArchiveConfirmation,
  onArchive,
  showExportOption = false,
  isSummaryFeedbackPopup = false,
  hideSummaryFeedbackPopup,
  onSubmitSummaryFeedback,
}) => {
  const {t} = useTranslation();
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
      <SummaryDropdown
        visible={isSummaryDropdownVisible}
        onClose={hideHeaderDropdown}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={hideMenu}
        onExport={handleExport}
        actionType={actionType}
        onArchive={() => setShowArchiveConfirmation(true)}
        setModalType={setActiveModal}
        showExportOption={showExportOption}
      />
      <FeedbackPopup
        note={t('FeedbackPopup.instructionText')}
        visible={isSummaryFeedbackPopup}
        onClose={hideSummaryFeedbackPopup}
        onSubmit={onSubmitSummaryFeedback}
      />
      {actionType && (
        <ArchiveActionModal
          visible={showArchiveConfirmation}
          onClose={() => setShowArchiveConfirmation(false)}
          actionType={actionType}
          setActionType={setActionType}
          onArchive={onArchive}
        />
      )}
    </>
  );
};
