import React from 'react';
import {useTranslation} from 'react-i18next';

import {CustomMenuModal, DeleteRenameModal, SummaryDropdown} from '../index';

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
  isSummaryAvailable?: boolean;
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
  isSummaryAvailable = false,
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
        setModalType={setActiveModal}
        showExportOption={isSummaryAvailable}
      />
    </>
  );
};
