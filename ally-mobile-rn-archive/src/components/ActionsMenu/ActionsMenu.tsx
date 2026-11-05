import {useRef, useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ThreeDotsIcon} from '@/assets';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';

interface ActionOption {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  label: string;
  onPress: () => void;
}

interface ActionsMenuProps {
  options: ActionOption[];
  icon?: React.ReactNode;
  iconSize?: number;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  options,
  icon,
  iconSize = 24,
}) => {
  const [openMenu, setOpenMenu] = useState<boolean>(false);
  const [menuPosition, setMenuPosition] = useState({x: 0, y: 0});
  const buttonRef = useRef<View>(null);

  const TriggerIcon = icon || (
    <ThreeDotsIcon
      width={iconSize}
      height={iconSize}
      color={colors.ds.icon.default}
    />
  );

  const handleOpenMenu = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setMenuPosition({
        x: x + width - 160, // Align menu to the right of the button
        y: y + height + 4, // Position below the button with small gap
      });
      setOpenMenu(true);
    });
  };

  return (
    <>
      <View ref={buttonRef} collapsable={false}>
        <TouchableOpacity onPress={handleOpenMenu}>
          {TriggerIcon}
        </TouchableOpacity>
      </View>

      <Modal
        visible={openMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenMenu(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setOpenMenu(false)}>
          <View
            style={[
              styles.menu,
              {
                left: menuPosition.x,
                top: menuPosition.y,
              },
            ]}>
            {options.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={styles.menuItem}
                onPress={() => {
                  option.onPress();
                  setOpenMenu(false);
                }}>
                <View style={styles.menuItemContainer}>
                  {option.leftIcon && (
                    <View style={styles.menuItemIcon}>{option.leftIcon}</View>
                  )}
                  <Text style={styles.menuItemText}>{option.label}</Text>
                  {option.rightIcon && (
                    <View style={styles.menuItemIcon}>{option.rightIcon}</View>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = ScaledSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0)',
  },
  menu: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: '8@s',
    minWidth: '160@s',
    shadowColor: colors.lightGray11,
    shadowOffset: {
      width: 2,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 11,
    elevation: 6,
  },
  menuItem: {
    paddingVertical: '10@s',
    paddingHorizontal: '16@s',
  },
  menuItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.black,
  },
  menuItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  menuItemIcon: {
    alignSelf: 'flex-start',
  },
});
