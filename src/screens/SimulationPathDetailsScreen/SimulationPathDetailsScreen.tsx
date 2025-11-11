import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {BoltIcon, DataUnavailableIcon, LeftArrowIcon} from '@/assets';
import {PrimaryButton} from '@/components';
import {EmptyState} from '@/components/EmptyState/EmptyState';
import {SCREEN_NAMES} from '@/constants';
import {useSimulationCredits, useTranslate} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useGetSimulationPathDetailsQuery} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {PathSimulationCard} from './components/PathSimulationCard';
import {ProgressBar} from './components/ProgressBar';

export const SimulationPathDetailsScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.SIMULATION_PATH_DETAILS>
> = ({navigation, route}) => {
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {pathId} = route.params;
  /**
   * TODO: When path details API is ready, this will automatically use it
   * Currently uses mock implementation that fetches scenarios internally
   * See src/services/simulationsApi.ts for API integration instructions
   */
  const {
    data: pathData,
    isLoading,
    error,
  } = useGetSimulationPathDetailsQuery({pathId});

  /**
   * Credits display logic - matches SimulationsScreen implementation
   */
  const {credits, getCreditsInfo} = useSimulationCredits();

  // Determine next simulation (first incomplete, unlocked simulation)
  const nextSimulation = pathData?.simulations?.find(
    sim => !sim.completed && !sim.locked,
  );

  const isPathStarted = (pathData?.completedCount ?? 0) > 0;

  const handleBack = () => {
    navigation.goBack();
  };

  /**
   * TODO: Implement Start/Continue button navigation
   * This will navigate to the next available simulation
   */
  const handleStartPath = () => {
    if (nextSimulation) {
      // eslint-disable-next-line no-console
      console.log('Starting/Continuing simulation:', nextSimulation.title);
      // TODO: When simulation details integration is ready, uncomment:
      // navigation.navigate(SCREEN_NAMES.SIMULATION_DETAILS, {
      //   scenario: {
      //     id: nextSimulation.id,
      //     title: nextSimulation.title,
      //     description: nextSimulation.description,
      //     coverImageUrl: nextSimulation.thumbnailUrl,
      //   },
      // });
    }
  };

  /**
   * TODO: Implement simulation card press navigation
   * This will navigate to the selected simulation if it's unlocked
   */
  const handleSimulationPress = (simulationId: string) => {
    const simulation = pathData?.simulations?.find(
      sim => sim.id === simulationId,
    );
    if (simulation && !simulation.locked) {
      // eslint-disable-next-line no-console
      console.log('Opening simulation:', simulation.title);
      // TODO: When simulation details integration is ready, uncomment:
      // navigation.navigate(SCREEN_NAMES.SIMULATION_DETAILS, {
      //   scenario: {
      //     id: simulation.id,
      //     title: simulation.title,
      //     description: simulation.description,
      //     coverImageUrl: simulation.thumbnailUrl,
      //   },
      // });
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={handleBack} style={styles.backButton}>
        <LeftArrowIcon color={colors.ds.typography.highEmphasis} />
      </TouchableOpacity>
      <Text style={styles.pageTitle}>{t('Simulations.pathWay')}</Text>
      <View style={styles.headerSpacer} />
      {credits && getCreditsInfo && (
        <View style={styles.creditDisplay}>
          <BoltIcon width={14} height={14} />
          <Text
            style={[
              styles.creditText,
              getCreditsInfo.isLow && styles.creditTextLow,
            ]}>
            {credits.consumedCredits}
            <Text style={styles.creditLimitText}>/{credits.creditLimit}</Text>
          </Text>
        </View>
      )}
    </View>
  );

  const renderListHeaderComponent = () => {
    if (!pathData) return null;

    return (
      <View style={styles.listHeaderSection}>
        {pathData.coverImageUrl && (
          <Image
            source={{uri: pathData.coverImageUrl}}
            style={styles.coverImage}
            resizeMode="cover"
          />
        )}
        <View style={styles.listHeaderContent}>
          <Text style={styles.pathTitle}>{pathData.title}</Text>
          <Text style={styles.pathDescription}>{pathData.description}</Text>

          {/* Progress bar - shows completion status */}
          <View style={styles.progressBarContainer}>
            <ProgressBar
              current={pathData.completedCount ?? 0}
              total={pathData.totalCount ?? 1}
            />
          </View>

          {/* Start/Continue button */}
          <PrimaryButton
            label={
              isPathStarted ? t('Simulations.continue') : t('Simulations.start')
            }
            onPress={handleStartPath}
            isDisabled={!nextSimulation}
          />
        </View>
      </View>
    );
  };

  const renderSimulationItem = ({
    item,
    index,
  }: {
    item: NonNullable<typeof pathData>['simulations'][0];
    index: number;
  }) => {
    const isNext = nextSimulation?.id === item.id;

    return (
      <PathSimulationCard
        order={item.order ?? index + 1}
        title={item.title ?? ''}
        thumbnailUrl={item.thumbnailUrl}
        isLocked={item.locked ?? false}
        isCompleted={item.completed ?? false}
        isNext={isNext}
        onPress={() => handleSimulationPress(item.id)}
      />
    );
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {renderHeader()}
      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={colors.ds.theme.primary}
          style={styles.loadingContainer}
          testID="activity-indicator"
        />
      ) : error || !pathData?.simulations ? (
        <View style={[styles.container, styles.centerContent]}>
          <EmptyState
            icon={DataUnavailableIcon}
            title={t('Simulations.failedToLoadPathDetails')}
          />
        </View>
      ) : (
        <FlatList
          data={pathData?.simulations || []}
          keyExtractor={item => item.id}
          renderItem={renderSimulationItem}
          ListHeaderComponent={renderListHeaderComponent}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16@ms',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginBottom: '18@ms',
    marginHorizontal: '10@ms',
    paddingTop: '16@ms',
    paddingBottom: '8@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.ds.typography.highEmphasis,
  },
  headerSpacer: {
    flex: 1,
  },
  creditDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  creditText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  creditTextLow: {
    color: colors.ds.red[300],
  },
  creditLimitText: {
    ...typography.body.tiny,
    color: colors.darkGray,
  },
  scrollContent: {
    paddingHorizontal: '21@ms',
    paddingBottom: '32@ms',
  },
  listHeaderSection: {
    marginTop: '16@ms',
    marginBottom: '16@ms',
  },
  coverImage: {
    width: '100%',
    height: '177@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.grey[200],
    marginBottom: '12@ms',
  },
  listHeaderContent: {
    gap: '12@ms',
  },
  pathTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  pathDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  progressBarContainer: {
    marginVertical: '12@ms',
    width: '60%',
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
