import {useEffect, useState} from 'react';

import {
  useGetAvailableLanguagesQuery,
  useGetUserPreferencesQuery,
} from '@/services';

interface UseLanguageDropdownOptions {
  skipFetchPreferences?: boolean;
  isFocused?: boolean;
}

interface UseLanguageDropdownReturn {
  selectedLanguage: string;
  setSelectedLanguage: (language: string) => void;
  isLanguageDropdownOpen: boolean;
  setIsLanguageDropdownOpen: (isOpen: boolean) => void;
  languageOptions: string[];
  languageMap: Map<string, number>;
  isLoading: boolean;
}

/**
 * Custom hook to manage language dropdown state and initialization
 * Consolidates repeated logic for fetching available languages,
 * user preferences, and initializing language options and map
 *
 * @param options - Configuration options
 * @returns Object containing language dropdown state and handlers
 */
export const useLanguageDropdown = (
  options: UseLanguageDropdownOptions = {},
): UseLanguageDropdownReturn => {
  const {skipFetchPreferences = false, isFocused} = options;

  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [languageMap, setLanguageMap] = useState<Map<string, number>>(
    new Map(),
  );

  // Fetch available languages
  const {data: languagesData, isLoading} = useGetAvailableLanguagesQuery({
    active: true,
    hasVoices: true,
  });

  // Fetch user preferences to get default language
  const {data: preferencesData, refetch: refetchPreferences} =
    useGetUserPreferencesQuery();

  // Refetch preferences when screen is focused (if isFocused is provided)
  useEffect(() => {
    if (isFocused !== undefined) {
      if (isFocused) {
        refetchPreferences();
      }
    }
  }, [isFocused, refetchPreferences]);

  // Initialize languages options and map
  useEffect(() => {
    if (languagesData && Array.isArray(languagesData)) {
      const langOptions = languagesData.map(lang => lang.label);
      const map = new Map(
        languagesData.map(lang => [lang.label, lang.language_id]),
      );
      setLanguageOptions(langOptions);
      setLanguageMap(map);
    }
  }, [languagesData]);

  // Set selected language from user preferences or first option
  useEffect(() => {
    if (languagesData && Array.isArray(languagesData)) {
      if (!skipFetchPreferences && preferencesData?.data?.default_language_id) {
        const selectedLang = languagesData.find(
          lang => lang.language_id === preferencesData.data.default_language_id,
        );
        if (selectedLang) {
          setSelectedLanguage(selectedLang.label);
        } else if (languageOptions.length > 0) {
          // Fall back to first option if preference language not found
          setSelectedLanguage(languageOptions[0]);
        }
      } else if (languageOptions.length > 0) {
        setSelectedLanguage(languageOptions[0]);
      }
    }
  }, [languagesData, preferencesData, skipFetchPreferences, languageOptions]);

  return {
    selectedLanguage,
    setSelectedLanguage,
    isLanguageDropdownOpen,
    setIsLanguageDropdownOpen,
    languageOptions,
    languageMap,
    isLoading,
  };
};
