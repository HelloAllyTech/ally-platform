import React, {useMemo} from 'react';
import {Trans, useTranslation} from 'react-i18next';
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

  const renderItem = ({item}: {item: Scenario}) => {
    // TODO: Move this after the API is updated and add enum
    const isComingSoon = item.status === 'Coming Soon';

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.card}
        onPress={() => handleStart(item)}
        disabled={isComingSoon}>
        {!!item.cover_image && (
          <>
            <View style={isComingSoon && styles.grayscaleWrapper}>
              <Image
                source={{uri: item.cover_image}}
                style={styles.cover}
                resizeMode="cover"
                onError={() => {}}
                blurRadius={isComingSoon ? 25 : 0}
              />
            </View>

            {isComingSoon && (
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>
                  {t('Common.comingSoon')}
                </Text>
              </View>
            )}
          </>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title || '-'}
          </Text>
          {!!item.short_description && (
            <Text style={styles.cardDesc} numberOfLines={3}>
              {item.short_description}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const ListEmptyElement = useMemo(
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
        <View style={styles.brandHeader}>
          <Text style={styles.brandTitle}>
            {t('Simulations.header.title')}{' '}
            <Text style={styles.brandTitleItalic}>
              {t('Simulations.header.subtitle')}
            </Text>
          </Text>
        </View>
        <View style={styles.marginH22}>
          <View style={styles.introWrapper}>
            <Text style={styles.introText}>
              <Trans
                i18nKey="Simulations.learnIntro"
                components={{
                  ai: <Text style={styles.blueBold} />,
                  counsellors: <Text style={styles.blueBold} />,
                  expertise: <Text style={styles.blueBold} />,
                }}
              />
            </Text>
          </View>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>
              {t('Simulations.chooseYour')}{' '}
              <Text style={styles.pageTitleItalic}>
                {t('Simulations.scenarioWord')}
              </Text>
            </Text>
          </View>
          <View style={styles.listHeaderRow}>
            <Text style={styles.scenariosText}>
              {t('Simulations.scenariosCaps')}
            </Text>
            <View style={styles.sectionRule} />
          </View>
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
        contentContainerStyle={[styles.list, styles.marginH22]}
        data={scenarios}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListEmptyComponent={!isFetching ? ListEmptyElement : null}
        showsVerticalScrollIndicator={false}
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
    paddingTop: '10@ms',
    paddingBottom: '90@ms',
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
  grayscaleWrapper: {
    filter: 'grayscale(100%)',
  },
  comingSoonBadge: {
    position: 'absolute',
    top: '8@ms',
    left: '8@ms',
    backgroundColor: colors.white,
    paddingVertical: '4@ms',
    paddingHorizontal: '8@ms',
    borderRadius: '6@ms',
    borderWidth: 1,
    borderColor: colors.lightGray8,
  },
  comingSoonText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkSlate,
    fontSize: '12@ms',
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
  listTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '22@ms',
  },
  pageTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  introWrapper: {
    marginTop: '38@ms',
    marginBottom: '16@ms',
  },
  introText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkSlate,
    fontSize: '18@ms',
  },
  blueBold: {
    ...fontFamily.REPLAY_PRO.BOLD,
    color: colors.azureBlue,
  },
  listHeader: {
    marginBottom: '16@ms',
  },
  brandHeader: {
    paddingTop: '8@ms',
    paddingBottom: '8@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  brandTitle: {
    marginHorizontal: '24@ms',
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray2,
    fontSize: '18@ms',
  },
  brandTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    paddingBottom: '6@ms',
  },
  scenariosText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.darkGray8,
    fontSize: '12@ms',
    letterSpacing: 4,
  },
  sectionRule: {
    flex: 1,
    height: 0.6,
    marginRight: '4@ms',
    backgroundColor: colors.lightGray10,
  },
  marginH22: {
    marginHorizontal: '22@ms',
  },
});
