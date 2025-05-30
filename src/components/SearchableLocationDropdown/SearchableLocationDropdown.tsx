import React, {useEffect, useRef, useState} from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, SearchIcon} from '@/assets/icons';
import commonStyles from '@/components/styles';
import useTranslate from '@/hooks/useTranslate';
import {
  Place,
  useGetPlacesQuery,
  useLazySearchPlacesQuery,
} from '@/services/placesApi';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface SearchableLocationDropdownProps {
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const SearchableLocationDropdown: React.FC<
  SearchableLocationDropdownProps
> = props => {
  const {t} = useTranslate();
  const {
    value,
    onSelect,
    disabled = false,
    isOpen,
    setIsOpen,
    placeholder = t('LocationDropdown.placeholder'),
  } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [headerLayout, setHeaderLayout] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const headerRef = useRef<View>(null);
  const [searchPlaces, {data: searchResults, isLoading}] =
    useLazySearchPlacesQuery();

  const {data: initialPlaces, isLoading: isLoadingInitial} = useGetPlacesQuery({
    page: 1,
    limit: 20,
  });

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      searchPlaces({query: searchQuery});
    } else if (isOpen && initialPlaces && Array.isArray(initialPlaces.data)) {
      setPlaces(initialPlaces.data);
    } else if (isOpen && initialPlaces) {
      setPlaces(initialPlaces.data || []);
    } else {
      setPlaces([]);
    }
  }, [searchQuery, searchPlaces, isOpen, initialPlaces]);

  useEffect(() => {
    if (searchResults && Array.isArray(searchResults)) {
      setPlaces(searchResults);
    } else if (searchResults) {
      setPlaces([]);
    }
  }, [searchResults, searchQuery]);

  // Set initial places when they're first loaded
  useEffect(() => {
    if (
      initialPlaces &&
      initialPlaces.data &&
      Array.isArray(initialPlaces.data) &&
      isOpen &&
      searchQuery.trim().length === 0
    ) {
      setPlaces(initialPlaces.data);
    }
  }, [initialPlaces, isOpen, searchQuery]);

  const toggleDropdown = () => {
    if (!disabled) {
      if (!isOpen && headerRef.current) {
        headerRef.current.measureInWindow((x, y, width, height) => {
          setHeaderLayout({x, y, width, height});
        });
      }
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
        setPlaces([]);
      }
    }
  };

  const handleSelect = (place: Place) => {
    const displayName = `${place.city}, ${place.state}`;
    onSelect(displayName);
    setIsOpen(false);
    setSearchQuery('');
    setPlaces([]);
  };

  return (
    <>
      <View style={styles.mainContainer}>
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
                    top: headerLayout.y + headerLayout.height + 2,
                    left: headerLayout.x,
                    width: headerLayout.width,
                    maxHeight: ms(300),
                  },
                ]}>
                <View style={styles.searchContainer}>
                  <SearchIcon
                    width={16}
                    height={16}
                    style={styles.searchIconStyle}
                  />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('LocationDropdown.searchPlaceholder')}
                    placeholderTextColor={colors.lightGray3}
                    autoFocus
                  />
                </View>

                <ScrollView
                  style={styles.scrollView}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled">
                  {(isLoading || isLoadingInitial) && places.length === 0 ? (
                    <View style={styles.loadingContainer}>
                      <Text style={styles.loadingText}>
                        {searchQuery.length > 0
                          ? t('LocationDropdown.searching')
                          : t('LocationDropdown.loadingPlaces')}
                      </Text>
                    </View>
                  ) : places.length > 0 ? (
                    places.map((place, index) => (
                      <TouchableOpacity
                        key={place.id}
                        style={[
                          styles.item,
                          index === places.length - 1 && styles.lastOption,
                        ]}
                        onPress={() => handleSelect(place)}
                        activeOpacity={0.7}>
                        <Text style={styles.itemText}>
                          {place.city}, {place.state}
                        </Text>
                      </TouchableOpacity>
                    ))
                  ) : searchQuery.length > 0 ? (
                    <View style={styles.noResultsContainer}>
                      <Text style={styles.noResultsText}>
                        {t('LocationDropdown.noLocationsFound')}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.instructionContainer}>
                      <Text style={styles.instructionText}>
                        {t('LocationDropdown.startTypingToSearch')}
                      </Text>
                    </View>
                  )}
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
    alignSelf: 'stretch',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '4@ms',
    paddingHorizontal: '12@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.white,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '8@ms',
    paddingHorizontal: '12@ms',
    borderWidth: 1,
    borderColor: colors.lightGray7,
    borderRadius: '6@ms',
    backgroundColor: colors.lightGray,
    margin: '12@ms',
    marginBottom: '12@ms',
  },
  searchIconStyle: {
    marginRight: '8@ms',
  },
  searchInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  scrollView: {
    maxHeight: '200@ms',
  },
  scrollContent: {
    flexGrow: 1,
  },
  item: {
    paddingVertical: '12@ms',
    paddingHorizontal: '16@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
  },
  lastOption: {
    borderBottomWidth: 0,
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  loadingContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  noResultsContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  noResultsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
  },
  instructionContainer: {
    padding: '20@ms',
    alignItems: 'center',
  },
  instructionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
});
