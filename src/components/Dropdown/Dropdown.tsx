import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ArrowDown} from '@/assets/icons';
import commonStyles from '@/components/styles';
import {colors, fontFamily, typography} from '@/theme';

interface DropdownProps {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  zIndex?: number;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onDropdownToggle?: (isOpen: boolean) => void;
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
  onDropdownToggle,
}) => {
  const [dropdownWidth, setDropdownWidth] = useState<number>(0);
  const [headerLayout, setHeaderLayout] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const animation = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const headerRef = useRef<View>(null);

  useEffect(() => {
    Animated.timing(animation, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();

    // Notify parent about dropdown state change
    onDropdownToggle?.(isOpen);
  }, [isOpen, animation, onDropdownToggle]);

  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const toggleDropdown = () => {
    if (!disabled) {
      if (!isOpen && headerRef.current) {
        // Measure header position when opening
        headerRef.current.measureInWindow((x, y, width, height) => {
          setHeaderLayout({x, y, width, height});
        });
      }
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (item: string) => {
    onSelect(item);
    setIsOpen(false);
  };

  const getLongestOption = (optionsList: string[]) => {
    return optionsList.reduce((a, b) => (a.length > b.length ? a : b), '');
  };

  const dynamicStyles = {
    mainContainer: {
      zIndex: isOpen ? zIndex : 0,
    },
  };

  return (
    <>
      <View style={[styles.mainContainer, dynamicStyles.mainContainer]}>
        <TouchableOpacity
          ref={headerRef}
          onPress={toggleDropdown}
          style={[styles.header, disabled && styles.disabled]}
          disabled={disabled}>
          <Text
            style={[commonStyles.fieldValueText, !value && styles.placeholder]}>
            {value || placeholder}
          </Text>
          <View style={[styles.arrow, isOpen && styles.arrowUp]}>
            <ArrowDown width={6} height={6} />
          </View>
        </TouchableOpacity>

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

      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={() => setIsOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setIsOpen(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalDropdown,
                  {
                    top: headerLayout.y + headerLayout.height - ms(2),
                    left: headerLayout.x,
                    minWidth: Math.max(dropdownWidth, headerLayout.width),
                    maxHeight: Math.min(200, options.length * 40),
                  },
                ]}>
                <ScrollView
                  ref={scrollViewRef}
                  nestedScrollEnabled
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator
                  bounces={false}
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
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalDropdown: {
    position: 'absolute',
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
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  selectedItem: {
    color: colors.ds.theme.primary,
    fontWeight: '500',
  },
  hiddenTextContainer: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
  },
});
