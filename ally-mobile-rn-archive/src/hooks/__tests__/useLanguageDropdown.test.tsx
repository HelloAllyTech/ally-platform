import {act, renderHook, waitFor} from '@testing-library/react-native';

import {useLanguageDropdown} from '../useLanguageDropdown';

// Mock the services
jest.mock('@/services', () => ({
  useGetAvailableLanguagesQuery: jest.fn(),
  useGetUserPreferencesQuery: jest.fn(),
}));

import {
  useGetAvailableLanguagesQuery,
  useGetUserPreferencesQuery,
} from '@/services';

const mockLanguagesData = [
  {
    language_id: 1,
    label: 'English',
    active: true,
    translationCode: 'en',
    value: 'en-IN',
  },
  {
    language_id: 2,
    label: 'Hindi',
    active: true,
    translationCode: 'hi',
    value: 'hi-IN',
  },
  {
    language_id: 3,
    label: 'Bengali',
    active: true,
    translationCode: 'bn',
    value: 'bn-IN',
  },
];

const mockPreferencesData = {
  data: {
    default_language_id: 2, // Hindi
  },
};

describe('useLanguageDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty state when no data is available', () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: undefined,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current.selectedLanguage).toBe('');
      expect(result.current.isLanguageDropdownOpen).toBe(false);
      expect(result.current.languageOptions).toEqual([]);
      expect(result.current.languageMap.size).toBe(0);
      expect(result.current.isLoading).toBe(true);
    });

    it('should initialize with default language from user preferences', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('Hindi');
      });

      expect(result.current.languageOptions).toEqual([
        'English',
        'Hindi',
        'Bengali',
      ]);
    });

    it('should initialize with first language option when no user preference', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: undefined,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('English');
      });
    });
  });

  describe('language options and mapping', () => {
    it('should create correct language map from languages data', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.languageMap.size).toBe(3);
      });

      expect(result.current.languageMap.get('English')).toBe(1);
      expect(result.current.languageMap.get('Hindi')).toBe(2);
      expect(result.current.languageMap.get('Bengali')).toBe(3);
    });

    it('should extract correct language options from data', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: undefined,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.languageOptions.length).toBe(3);
      });

      expect(result.current.languageOptions).toEqual([
        'English',
        'Hindi',
        'Bengali',
      ]);
    });
  });

  describe('dropdown state management', () => {
    it('should toggle dropdown open state', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current.isLanguageDropdownOpen).toBe(false);

      act(() => {
        result.current.setIsLanguageDropdownOpen(true);
      });

      expect(result.current.isLanguageDropdownOpen).toBe(true);

      act(() => {
        result.current.setIsLanguageDropdownOpen(false);
      });

      expect(result.current.isLanguageDropdownOpen).toBe(false);
    });

    it('should update selected language', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('Hindi');
      });

      act(() => {
        result.current.setSelectedLanguage('Bengali');
      });

      expect(result.current.selectedLanguage).toBe('Bengali');
    });
  });

  describe('skipFetchPreferences option', () => {
    it('should skip user preferences when skipFetchPreferences is true', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() =>
          useLanguageDropdown({skipFetchPreferences: true}),
        );
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('English');
      });

      expect(result.current.languageOptions).toEqual([
        'English',
        'Hindi',
        'Bengali',
      ]);
    });

    it('should use user preferences when skipFetchPreferences is false', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() =>
          useLanguageDropdown({skipFetchPreferences: false}),
        );
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('Hindi');
      });
    });
  });

  describe('isFocused option', () => {
    it('should refetch preferences when isFocused is true', async () => {
      const mockRefetch = jest.fn();

      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
        refetch: mockRefetch,
      });

      const {rerender} = renderHook(
        ({isFocused}) => useLanguageDropdown({isFocused}),
        {
          initialProps: {isFocused: false},
        },
      );

      expect(mockRefetch).not.toHaveBeenCalled();

      rerender({isFocused: true});

      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });
    });

    it('should not refetch when isFocused is false', async () => {
      const mockRefetch = jest.fn();

      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
        refetch: mockRefetch,
      });

      renderHook(() => useLanguageDropdown({isFocused: false}));

      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it('should not refetch when isFocused is undefined', async () => {
      const mockRefetch = jest.fn();

      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
        refetch: mockRefetch,
      });

      renderHook(() => useLanguageDropdown());

      expect(mockRefetch).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty languages data array', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current.languageOptions).toEqual([]);
      expect(result.current.languageMap.size).toBe(0);
      expect(result.current.selectedLanguage).toBe('');
    });

    it('should handle null languages data', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: null,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current.languageOptions).toEqual([]);
      expect(result.current.languageMap.size).toBe(0);
    });

    it('should handle undefined preferences data', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: undefined,
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('English');
      });
    });

    it('should handle language not found in available languages', async () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: {
          data: {
            default_language_id: 999, // Non-existent ID
          },
        },
      });

      const {result} = await waitFor(() => {
        const hook = renderHook(() => useLanguageDropdown());
        return hook;
      });

      await waitFor(() => {
        // Should fall back to first option since preference language not found
        expect(result.current.selectedLanguage).toBe('English');
      });
    });
  });

  describe('data updates', () => {
    it('should update language options when languages data changes', async () => {
      const {rerender} = renderHook(
        ({languagesData}) => {
          (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
            data: languagesData,
            isLoading: false,
          });

          (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
            data: undefined,
          });

          return useLanguageDropdown();
        },
        {
          initialProps: {languagesData: mockLanguagesData},
        },
      );

      const newLanguagesData = [
        ...mockLanguagesData,
        {
          language_id: 4,
          label: 'Gujarati',
          active: true,
          translationCode: 'gu',
          value: 'gu-IN',
        },
      ];

      rerender({languagesData: newLanguagesData});
    });

    it('should update selected language when preferences data changes', async () => {
      const mockRefetch = jest.fn();

      const {result, rerender} = renderHook(
        ({preferences}: {preferences?: typeof mockPreferencesData}) => {
          (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
            data: mockLanguagesData,
            isLoading: false,
          });

          (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
            data: preferences,
            refetch: mockRefetch,
          });

          return useLanguageDropdown();
        },
        {
          initialProps: {
            preferences: undefined as typeof mockPreferencesData | undefined,
          },
        },
      );

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('English');
      });

      rerender({preferences: mockPreferencesData});

      await waitFor(() => {
        expect(result.current.selectedLanguage).toBe('Hindi');
      });
    });
  });

  describe('return values', () => {
    it('should return all expected properties', () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current).toHaveProperty('selectedLanguage');
      expect(result.current).toHaveProperty('setSelectedLanguage');
      expect(result.current).toHaveProperty('isLanguageDropdownOpen');
      expect(result.current).toHaveProperty('setIsLanguageDropdownOpen');
      expect(result.current).toHaveProperty('languageOptions');
      expect(result.current).toHaveProperty('languageMap');
      expect(result.current).toHaveProperty('isLoading');
    });

    it('should return functions for setters', () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: mockLanguagesData,
        isLoading: false,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: mockPreferencesData,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(typeof result.current.setSelectedLanguage).toBe('function');
      expect(typeof result.current.setIsLanguageDropdownOpen).toBe('function');
    });

    it('should return isLoading state from query', () => {
      (useGetAvailableLanguagesQuery as jest.Mock).mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      (useGetUserPreferencesQuery as jest.Mock).mockReturnValue({
        data: undefined,
      });

      const {result} = renderHook(() => useLanguageDropdown());

      expect(result.current.isLoading).toBe(true);
    });
  });
});
