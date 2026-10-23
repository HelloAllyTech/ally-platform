import React, {useCallback} from 'react';
import {FlatList, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {CancelIcon, CheckCircleIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import {formatAsPercentage} from '@/utils';

import {ProgressBar} from '../LearningPathDetails';

export interface SessionChecklistItem {
  id: string;
  name: string;
  completed: boolean;
}
export interface SessionChecklistProps {
  /**
   * Array of checklist items to display
   */
  items: SessionChecklistItem[];
}

/**
 * Checklist Component
 *
 * Displays a post-simulation session checklist with a progress bar
 * and a list of items showing completed (green check) or
 * incomplete (red cancel) status.
 */
export const SessionChecklist: React.FC<SessionChecklistProps> = ({items}) => {
  const {t} = useTranslate();

  const completedCount = items.filter(item => item.completed).length;
  const totalCount = items.length;

  const renderHeader = (completedItems: number, totalItems: number) => {
    return (
      <View style={styles.headerContainer}>
        <Text style={styles.title}>{t('learn.evaluationChecklist')}</Text>
        <Text style={styles.percentageText}>
          {totalCount > 0 && formatAsPercentage(completedItems / totalItems)}
        </Text>
      </View>
    );
  };

  const renderProgressBar = () => {
    return (
      <View style={styles.progressBarContainer}>
        <ProgressBar
          current={completedCount}
          total={totalCount}
          height={ms(8)}
          inProgressColor={colors.ds.theme.primaryLight}
          isProgressTextVisible={false}
        />
      </View>
    );
  };

  const renderChecklistItem = useCallback(
    (item: SessionChecklistItem, index: number) => (
      <View
        key={item.id || `checklist-item-${index}`}
        style={[
          styles.checklistItem,
          item.completed ? styles.itemCompleted : styles.itemIncomplete,
        ]}>
        <Text style={styles.itemText}>{item.name}</Text>
        {item.completed ? (
          <CheckCircleIcon width={ms(19)} height={ms(19)} />
        ) : (
          <CancelIcon width={ms(19)} height={ms(19)} />
        )}
      </View>
    ),
    [],
  );

  if (totalCount === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {renderHeader(completedCount, totalCount)}
      {renderProgressBar()}

      <FlatList
        data={items}
        renderItem={({item, index}) => renderChecklistItem(item, index)}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.itemsContainer}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.ds.neutral.white,
    borderRadius: radius.lg,
    padding: '16@ms',
    width: '100%',
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    flex: 1,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  progressBarContainer: {
    marginBottom: '16@ms',
  },
  itemsContainer: {
    gap: '12@ms',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12@ms',
    gap: '16@ms',
    backgroundColor: colors.ds.grey[50],
    borderRadius: radius.lg,
    borderWidth: 0.5,
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
    flexShrink: 1,
  },
  itemCompleted: {
    backgroundColor: colors.lightGreen2,
    borderColor: colors.ds.green[400],
  },
  itemIncomplete: {
    backgroundColor: colors.lightRed,
    borderColor: colors.ds.red[400],
  },
  percentageText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
  },
});
