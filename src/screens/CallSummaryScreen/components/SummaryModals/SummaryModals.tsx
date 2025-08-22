import React from 'react';
import {useTranslation} from 'react-i18next';
import {Modal, Text, TouchableWithoutFeedback, View} from 'react-native';

import {styles} from '../../styles';
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
  showInfoModal: boolean;
  setShowInfoModal: (show: boolean) => void;
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
  showInfoModal,
  setShowInfoModal,
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
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}>
        <TouchableWithoutFeedback onPress={() => setShowInfoModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.infoPopupContainer}>
                <Text style={styles.infoPopupText}>
                  {t('CallSummary.info.notesAutoSaveInfo')}
                </Text>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};
