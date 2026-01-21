import {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ThreeDotsIcon} from '@/assets';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';

interface ActionOption {
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
  const TriggerIcon = icon || (
    <ThreeDotsIcon width={iconSize} height={iconSize} />
  );

  return (
    <>
      <TouchableOpacity
        onPress={() => {
          setOpenMenu(prev => !prev);
        }}>
        {TriggerIcon}
      </TouchableOpacity>
      {openMenu && (
        <>
          <View style={styles.overlayContainer}>
            <TouchableOpacity
              style={styles.overlayTouchable}
              activeOpacity={1}
              // onPress={() => setOpenMenu(false)}
            />
          </View>

          <View style={styles.menu}>
            {options.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={styles.menuItem}
                onPress={() => {
                  option.onPress();
                  setOpenMenu(false);
                }}>
                <Text style={styles.menuItemText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
  overlayTouchable: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    right: '8@s',
    bottom: '32@s',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: '8@s',
    minWidth: '160@s',
    zIndex: 9999,
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
});
