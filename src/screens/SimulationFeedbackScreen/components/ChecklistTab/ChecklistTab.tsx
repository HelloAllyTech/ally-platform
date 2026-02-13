import React from 'react';
import {Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {CancelIcon, CheckCircleIcon} from '@/assets';
import {ProgressBar} from '@/components/LearningPathDetails';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import {formatAsPercentage} from '@/utils';

import {SummaryCard} from '../SummaryCard';

interface ChecklistTabProps {
  scenarioSessionId?: string;
}

interface ChecklistItem {
  id: string;
  name: string;
  completed: boolean;
}

export const ChecklistTab: React.FC<ChecklistTabProps> = ({
  scenarioSessionId,
}) => {
  const {t} = useTranslate();

  // TODO: Fetch real checklist data using scenarioSessionId when API is ready
  // For now, use dummy data
  const dummyItems: ChecklistItem[] = [
    {
      id: '1',
      name: 'Item 1',
      completed: true,
    },
    {
      id: '2',
      name: 'Item 2',
      completed: true,
    },
    {
      id: '3',
      name: 'Item 3',
      completed: false,
    },
  ];

  const completedCount = dummyItems.filter(item => item.completed).length;
  const totalCount = dummyItems.length;

  return (
    <SummaryCard>
      {/* Title Header */}
      <View style={styles.headerContainer}>
        <Text style={styles.title}>
          {t('SimulationFeedback.checklistHeader')}
        </Text>
        <Text style={styles.percentageText}>
          {totalCount > 0 && formatAsPercentage(completedCount / totalCount)}
        </Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBarContainer}>
        <ProgressBar
          current={completedCount}
          total={totalCount}
          height={ms(8)}
          inProgressColor={colors.ds.theme.primaryLight}
          isProgressTextVisible={false}
        />
      </View>

      {/* Checklist Items */}
      <View style={styles.itemsContainer}>
        {dummyItems.map(item => (
          <View
            key={item.id}
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
        ))}
      </View>
    </SummaryCard>
  );
};

const styles = ScaledSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
  },
  percentageText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
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
});
