import React from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DeleteIcon, ExportIcon} from '@/assets/icons';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export interface CustomMenuModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const CustomMenuModal: React.FC<CustomMenuModalProps> = ({
  visible,
  onClose,
  onExport,
  onDelete,
}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPressOut={onClose}>
        <View style={[styles.menuContainer, {marginTop: insets.top + 56}]}>
          <TouchableOpacity style={styles.menuItem} onPress={onExport}>
            <Text style={styles.menuText}>
              {t('CallSummary.customMenu.export')}
            </Text>
            <ExportIcon width={16} height={16} />
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={onDelete}>
            <Text style={styles.menuText}>
              {t('CallSummary.customMenu.delete')}
            </Text>
            <DeleteIcon width={16} height={16} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.whiteTransparent10,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  menuContainer: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    marginTop: '60@ms',
    marginRight: '16@ms',
    paddingVertical: '4@ms',
    width: '200@ms',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '8@ms',
    paddingHorizontal: '20@ms',
  },
  menuText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '15@ms',
    color: colors.black,
  },
  menuDivider: {
    height: '0.5@ms',
    backgroundColor: colors.lightGray2,
    marginHorizontal: '10@ms',
  },
});

export default CustomMenuModal;
