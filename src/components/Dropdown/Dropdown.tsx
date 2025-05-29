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

import {ArrowDown} from '@/assets/icons';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface DropdownProps {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  zIndex?: number;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const CustomDropdown: React.FC<DropdownProps> = ({
  value,
  options,
  onSelect,
  placeholder = 'Select',
  disabled = false,
  zIndex = 1000,
  isOpen,
  setIsOpen,
}) => {
  const [dropdownWidth, setDropdownWidth] = useState<number>(0);
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animation, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isOpen, animation]);

  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
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

  const getLongestOption = (optionsList: string[]) => {
    return optionsList.reduce((a, b) => (a.length > b.length ? a : b), '');
  };

  return (
    <View style={[styles.mainContainer, {zIndex: isOpen ? zIndex : 1}]}>
      <TouchableOpacity
        onPress={toggleDropdown}
        style={[styles.header, disabled && styles.disabled]}
        disabled={disabled}>
        <Text style={[styles.headerText, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>
        <View style={[styles.arrow, isOpen && styles.arrowUp]}>
          <ArrowDown width={6} height={6} />
        </View>
      </TouchableOpacity>

      {isOpen && dropdownWidth > 0 && (
        <>
          <TouchableWithoutFeedback onPress={() => setIsOpen(false)}>
            <View style={[StyleSheet.absoluteFill, styles.backdrop]} />
          </TouchableWithoutFeedback>
          <Animated.View
            style={[
              styles.dropdown,
              {maxHeight: dropdownHeight, minWidth: dropdownWidth},
            ]}>
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
      <View style={styles.hiddenTextContainer}>
        <Text
          style={styles.itemText}
          onLayout={e => {
            const {width} = e.nativeEvent.layout;
            if (isMounted.current) {
              setDropdownWidth(Math.ceil(width + 36));
            }
          }}>
          {getLongestOption(options)}
        </Text>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  mainContainer: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '4@ms',
    paddingHorizontal: '12@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.white,
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    fontWeight: '400',
  },
  placeholder: {
    color: colors.charcoal2,
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
  arrow: {
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
    borderRadius: '10@ms',
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
    paddingVertical: '8@ms',
    paddingHorizontal: '16@ms',
  },
  lastOption: {
    borderBottomWidth: 0,
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  selectedItem: {
    color: colors.teal,
    fontWeight: '500',
  },
  hiddenTextContainer: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
  },
});
