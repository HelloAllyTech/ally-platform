import {CustomModal} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

interface DeleteRenameModalProps {
  activeModal: string;
  setActiveModal: (modal: string | null) => void;
  handleDelete: () => void;
  handleBlur: () => void;
  editedName: string;
  setEditedName: (name: string) => void;
}

export const DeleteRenameModal: React.FC<DeleteRenameModalProps> = ({
  activeModal,
  setActiveModal,
  handleDelete,
  handleBlur,
  editedName,
  setEditedName,
}) => {
  const {t} = useTranslate();

  if (activeModal === 'delete') {
    return (
      <CustomModal
        visible={activeModal === 'delete'}
        onClose={() => setActiveModal(null)}
        title={t('callSummary.customMenu.delete')}
        primaryButtonText={t('callSummary.customMenu.delete')}
        secondaryButtonText={t('callSummary.info.cancel')}
        onPrimaryPress={handleDelete}
        onSecondaryPress={() => setActiveModal(null)}
        description={t('callSummary.customMenu.deleteConfirmation')}
        primaryTextColor={colors.brightRed}
      />
    );
  }

  if (activeModal === 'rename') {
    return (
      <CustomModal
        visible={activeModal === 'rename'}
        onClose={() => setActiveModal(null)}
        title={t('callSummary.info.rename')}
        primaryButtonText={t('callSummary.info.confirm')}
        secondaryButtonText={t('callSummary.info.cancel')}
        onPrimaryPress={handleBlur}
        onSecondaryPress={() => setActiveModal(null)}
        showInput
        inputProps={{
          value: editedName,
          onChangeText: setEditedName,
        }}
      />
    );
  }

  return null;
};
