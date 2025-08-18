import React, {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {
  FlatList,
  Image,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {useGetScenariosQuery} from '@/services';
import {colors, fontFamily} from '@/theme';
import type {Scenario} from '@/types';

export const SimulationsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {data, isFetching, refetch} = useGetScenariosQuery();
  const scenarios = data?.scenarios ?? [];

  const keyExtractor = (item: Scenario) => item.unique_id;

  useHardwareBackPressHandler(() => {
    navigation.goBack();
    return true;
  });

  const handleStart = (scenario: Scenario) => {
    navigation.navigate(SCREEN_NAMES.SIMULATION_DETAILS, {scenario});
  };

  const renderItem = ({item}: {item: Scenario}) => (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.card}
      onPress={() => handleStart(item)}>
      {!!item.cover_image && (
        <Image
          source={{uri: item.cover_image}}
          style={styles.cover}
          resizeMode="cover"
          onError={() => {}}
        />
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title || 'Untitled'}
        </Text>
        {!!item.short_description && (
          <Text style={styles.cardDesc} numberOfLines={3}>
            {item.short_description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const empty = useMemo(
    () => (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t('Simulations.noSimulations')}</Text>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const renderHeader = () => {
    return (
      <>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerLeft}
            onPress={() => navigation.goBack()}>
            <LeftArrowIcon color={colors.black} />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>
            {t('Simulations.chooseYour')}{' '}
            <Text style={styles.pageTitleItalic}>
              {t('Simulations.scenarioWord')}
            </Text>
          </Text>
        </View>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>
            {t('Simulations.scenariosCaps')}
          </Text>
          <View style={styles.sectionRule} />
        </View>
      </>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {renderHeader()}
      <FlatList
        contentContainerStyle={styles.list}
        data={scenarios}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListEmptyComponent={!isFetching ? empty : null}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} />
        }
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  list: {
    padding: '16@ms',
    paddingTop: '10@ms',
    gap: '12@ms',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderColor: colors.lightGray5,
    borderRadius: '8@ms',
    width: '100%',
    shadowColor: colors.darkGray12,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  cover: {
    width: '35%',
    minWidth: '130@ms',
    height: '120@ms',
    borderTopLeftRadius: '8@ms',
    borderBottomLeftRadius: '8@ms',
    backgroundColor: colors.lightGray4,
  },
  cardBody: {
    margin: '12@ms',
    width: '55%',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  cardTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '15@ms',
    fontWeight: '700',
    marginBottom: '6@ms',
  },
  cardDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkCharcoal,
    fontSize: '12@ms',
  },
  empty: {
    alignItems: 'center',
    marginTop: '40@ms',
    gap: '6@ms',
  },
  emptyTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '16@ms',
  },
  emptyDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray14,
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '22@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  header: {
    paddingHorizontal: '6@ms',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '8@ms',
    marginHorizontal: '6@ms',
  },
  headerLeft: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginHorizontal: '16@ms',
    paddingBottom: '6@ms',
  },
  sectionLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray8,
    fontSize: '12@ms',
    letterSpacing: 2,
  },
  sectionRule: {
    flex: 1,
    height: 0.6,
    marginRight: '4@ms',
    backgroundColor: colors.lightGray10,
  },
});
