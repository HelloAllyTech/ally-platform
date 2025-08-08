import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface CallLogHeaderProps {
  search: string;
  onSearchChange: (text: string) => void;
}

export const CallLogHeader: React.FC<CallLogHeaderProps> = ({
  search: _search,
  onSearchChange: _onSearchChange,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.headerRow}>
      <Text style={styles.headerTitle}>
        {t('CallLogs.header.title')}{' '}
        <Text style={styles.headerItalic}>{t('CallLogs.header.subtitle')}</Text>
      </Text>
      <View style={styles.searchBarContainer}>
        {/* TODO: Can uncomment later when we have the search and filter functionality */}
        {/* <View style={styles.searchBar}>
          <SearchIcon width={16} height={16} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('CallLogs.search.placeholder')}
            placeholderTextColor={colors.gray99}
            value={search}
            onChangeText={onSearchChange}
          />
        </View>
        <TouchableOpacity style={styles.filterCircle}>
          <FilterIcon width={16} height={16} />
        </TouchableOpacity> */}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '16@mvs',
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.darkSlate,
    fontWeight: '400',
  },
  headerItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
    fontWeight: '500',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: '28@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    height: '40@ms',
    minWidth: '180@ms',
    paddingHorizontal: '10@ms',
  },
  searchIcon: {
    marginRight: '10@ms',
  },
  searchInput: {
    height: '40@ms',
    fontSize: '12@ms',
    color: colors.darkSlate,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  filterCircle: {
    marginLeft: '10@ms',
    width: '40@ms',
    height: '40@ms',
    borderRadius: '20@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
