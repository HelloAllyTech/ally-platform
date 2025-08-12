import React, {useMemo} from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {useGetScenariosQuery} from '@/services/scenariosApi';
import {colors, fontFamily} from '@/theme';
import type {Scenario} from '@/types/scenarios';

export const SimulationsScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const {data, isFetching, refetch} = useGetScenariosQuery();
  const scenarios = data?.scenarios ?? [];

  const keyExtractor = (item: Scenario) => item.unique_id;

  useHardwareBackPressHandler(() => {
    navigation.goBack();
    return true;
  });

  const handleStart = (scenario: Scenario) => {
    navigation.navigate('SimulationDetails', {scenario});
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
        <Text style={styles.emptyTitle}>No simulations</Text>
        <Text style={styles.emptyDesc}>Pull to refresh</Text>
      </View>
    ),
    [],
  );

  return (
    <View style={styles.container}>
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
    width: '400@ms',
    height: '160@ms',
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
});
