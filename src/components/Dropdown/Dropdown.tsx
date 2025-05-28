import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface DropdownProps {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  zIndex?: number;
}

export const CustomDropdown: React.FC<DropdownProps> = ({
  value,
  options,
  onSelect,
  placeholder = 'Select',
  disabled = false,
  zIndex = 1000,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animation, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isOpen, animation]);

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(prev => !prev);
    }
  };

  const handleSelect = (item: string) => {
    onSelect(item);
    setIsOpen(false);
  };

  const dropdownHeight = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(200, options.length * 40)],
  });

  return (
    <View style={[styles.mainContainer, {zIndex: isOpen ? zIndex : 1}]}>
      <TouchableOpacity
        onPress={toggleDropdown}
        style={[styles.header, disabled && styles.disabled]}
        disabled={disabled}>
        <Text style={[styles.headerText, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>
        <Text style={[styles.arrow, isOpen && styles.arrowUp]}>▼</Text>
      </TouchableOpacity>

      {isOpen && (
        <>
          <TouchableWithoutFeedback onPress={() => setIsOpen(false)}>
            <View style={[StyleSheet.absoluteFill, styles.backdrop]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[styles.dropdown, {maxHeight: dropdownHeight}]}>
            <ScrollView
              nestedScrollEnabled
              scrollEventThrottle={16}
              onScrollBeginDrag={e => {
                e.stopPropagation();
              }}
              onScroll={e => {
                e.stopPropagation();
              }}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}>
              {options.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.item,
                    index === options.length - 1 && styles.lastOption,
                  ]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.itemText,
                      item === value && styles.selectedItem,
                    ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        </>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  mainContainer: {
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '8@ms',
    paddingHorizontal: '12@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lightGray7,
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.charcoal2,
    flex: 1,
  },
  placeholder: {
    color: colors.charcoal2,
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
  arrow: {
    fontSize: '12@ms',
    color: colors.charcoal2,
    marginLeft: '8@ms',
  },
  arrowUp: {
    transform: [{rotate: '180deg'}],
  },
  backdrop: {
    backgroundColor: 'transparent',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderRadius: '4@ms',
    borderWidth: 1,
    borderColor: colors.lightGray7,
    elevation: 5,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  scrollView: {
    maxHeight: '200@ms',
  },
  scrollContent: {
    flexGrow: 1,
  },
  item: {
    paddingVertical: '10@ms',
    paddingHorizontal: '15@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
  },
  lastOption: {
    borderBottomWidth: 0,
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.charcoal2,
  },
  selectedItem: {
    color: colors.teal,
    fontWeight: '500',
  },
});
