import React, {useEffect, useRef, useState} from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ms} from 'react-native-size-matters';

import {ArrowDown, SearchIcon} from '@/assets/icons';
import commonStyles from '@/components/styles';
import {PLACES_PER_PAGE, WINDOW_HEIGHT} from '@/constants';
import {useDebounce, useKeyboardState, useTranslate} from '@/hooks';
import {
  Place,
  useGetPlacesQuery,
  useLazySearchPlacesQuery,
} from '@/services/placesApi';
import {colors} from '@/theme';

import {styles} from './styles';

interface SearchableLocationDropdownProps {
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  modalTranslateX?: `${number}%` | number; // Optional translateX transform for modal dropdown positioning (e.g., '-50%')
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
    placeholder = t('locationDropdown.placeholder'),
    modalTranslateX,
  } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMorePages, setHasMorePages] = useState(true);

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
    page: currentPage,
    limit: PLACES_PER_PAGE,
  });

  // Use the simplified keyboard hook
  const keyboardState = useKeyboardState();

  // Create debounced search function
  const debouncedSearch = useDebounce(
    (query: string) => {
      if (query.trim().length > 0) {
        searchPlaces({query});
        // Reset pagination when searching
        setCurrentPage(1);
        setHasMorePages(true);
      }
    },
    {delay: 300},
  );

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      debouncedSearch(searchQuery);
    } else if (
      isOpen &&
      initialPlaces &&
      Array.isArray(initialPlaces.data) &&
      currentPage === 1
    ) {
      setPlaces(initialPlaces.data);
    } else if (isOpen && !searchQuery.trim().length && currentPage === 1) {
      // Reset to first page when opening dropdown without search
      setCurrentPage(1);
      setHasMorePages(true);
    }
  }, [searchQuery, debouncedSearch, isOpen, initialPlaces, currentPage]);

  useEffect(() => {
    if (searchResults && Array.isArray(searchResults)) {
      setPlaces(searchResults);
    } else if (searchResults) {
      setPlaces([]);
    }
  }, [searchResults, searchQuery]);

  // Handle pagination - append new places to existing list
  useEffect(() => {
    if (
      initialPlaces &&
      initialPlaces.data &&
      Array.isArray(initialPlaces.data)
    ) {
      if (currentPage === 1) {
        // First page - replace places
        setPlaces(initialPlaces.data);
        // If we got all the data in first request, no more pages needed
        setHasMorePages(initialPlaces.data.length < initialPlaces.total);
      } else {
        // Subsequent pages - append only unique places to existing places
        setPlaces(prevPlaces => {
          const existingIds = new Set(prevPlaces.map(place => place.id));
          const newPlaces = initialPlaces.data.filter(
            place => !existingIds.has(place.id),
          );
          return [...prevPlaces, ...newPlaces];
        });

        // Check if there are more pages
        const totalLoaded = currentPage * PLACES_PER_PAGE;
        setHasMorePages(totalLoaded < initialPlaces.total);
      }
    }
  }, [initialPlaces, currentPage]);

  const loadMorePlaces = () => {
    if (hasMorePages && !isLoadingInitial && searchQuery.trim().length === 0) {
      setCurrentPage(prev => prev + 1);
    }
  };

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
        // Reset pagination when opening dropdown
        setCurrentPage(1);
        setHasMorePages(true);
      }
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {layoutMeasurement, contentOffset, contentSize} = event.nativeEvent;
    const isCloseToBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 20;
    if (
      isCloseToBottom &&
      hasMorePages &&
      !isLoadingInitial &&
      searchQuery.trim().length === 0
    ) {
      loadMorePlaces();
    }
  };

  const handleSelect = (place: Place) => {
    const displayName = `${place.city}, ${place.state}`;
    onSelect(displayName);
    setIsOpen(false);
    setSearchQuery('');
    setPlaces([]);
  };

  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      <Text style={styles.loadingText}>
        {searchQuery.length > 0
          ? t('locationDropdown.searching')
          : t('locationDropdown.loadingPlaces')}
      </Text>
    </View>
  );

  const renderPlacesList = () => (
    <>
      {places.map((place, index) => (
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
      ))}
      {isLoadingInitial && currentPage > 1 && (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            {t('locationDropdown.loadingPlaces')}
          </Text>
        </View>
      )}
    </>
  );

  const renderNoResults = () => (
    <View style={styles.noResultsContainer}>
      <Text style={styles.noResultsText}>
        {t('locationDropdown.noLocationsFound')}
      </Text>
    </View>
  );

  const renderInstructions = () => (
    <View style={styles.instructionContainer}>
      <Text style={styles.instructionText}>
        {t('locationDropdown.startTypingToSearch')}
      </Text>
    </View>
  );

  const renderDropdownContent = () => {
    const isLoadingState =
      (isLoading || isLoadingInitial) && places.length === 0;
    const hasPlaces = places.length > 0;
    const hasSearchQuery = searchQuery.length > 0;

    if (isLoadingState) return renderLoadingState();
    if (hasPlaces) return renderPlacesList();
    if (hasSearchQuery) return renderNoResults();
    return renderInstructions();
  };

  // Calculate modal positioning considering keyboard
  const getModalPositioning = () => {
    const screenHeight = WINDOW_HEIGHT;
    const maxModalHeight = ms(300);
    const minSpacing = ms(20);

    // When keyboard is visible, adjust the modal position
    if (keyboardState.height > 0) {
      const availableHeight = screenHeight - keyboardState.height;
      const spaceBelow =
        availableHeight - (headerLayout.y + headerLayout.height);

      // If modal would be covered by keyboard, position it to fit above keyboard
      if (spaceBelow < maxModalHeight + minSpacing) {
        const adjustedTop = Math.max(
          minSpacing,
          availableHeight - maxModalHeight - minSpacing,
        );
        return {
          top: adjustedTop,
          left: headerLayout.x,
          width: headerLayout.width,
          maxHeight: Math.min(
            maxModalHeight,
            availableHeight - adjustedTop - minSpacing,
          ),
        };
      }
    }

    // Default positioning (keyboard hidden or enough space)
    const spaceBelow = screenHeight - (headerLayout.y + headerLayout.height);
    return {
      top: headerLayout.y + headerLayout.height - ms(2),
      left: headerLayout.x,
      width: headerLayout.width,
      maxHeight: Math.min(
        maxModalHeight,
        Math.max(ms(150), spaceBelow - minSpacing),
      ),
    };
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
                  getModalPositioning(),
                  modalTranslateX
                    ? {
                        transform: [{translateX: modalTranslateX}],
                      }
                    : null,
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
                    placeholder={t('locationDropdown.searchPlaceholder')}
                    placeholderTextColor={colors.lightGray3}
                    autoFocus
                  />
                </View>

                <ScrollView
                  style={styles.scrollView}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  onScroll={handleScroll}
                  scrollEventThrottle={16}>
                  {renderDropdownContent()}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};
