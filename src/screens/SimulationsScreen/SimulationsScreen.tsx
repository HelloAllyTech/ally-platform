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
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {useGetScenariosQuery} from '@/services';
import {colors, fontFamily} from '@/theme';
import type {Scenario} from '@/types';

export const SimulationsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
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

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.pageTitle}>
        {t('Simulations.chooseYour')}{' '}
        <Text style={styles.pageTitleItalic}>
          {t('Simulations.scenarioWord')}
        </Text>
      </Text>
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
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingTop: '20@ms',
  },
  list: {
    padding: '16@ms',
    gap: '12@ms',
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lightGray5,
    borderRadius: '8@ms',
    overflow: 'hidden',
    marginBottom: '12@ms',
  },
  cover: {
    width: '100%',
    height: '120@ms',
    backgroundColor: colors.lightGray4,
  },
  cardBody: {
    padding: '12@ms',
  },
  cardTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '18@ms',
    marginBottom: '6@ms',
  },
  cardDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkCharcoal,
    fontSize: '13@ms',
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
    fontSize: '28@ms',
    paddingHorizontal: '16@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
});
