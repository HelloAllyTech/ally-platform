import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {CancelIcon, CheckCircleIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {useGetEventChecklistQuery} from '@/services';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';

interface EventChecklistProps {
  scenarioSessionId: string;
}

export const EventChecklist: React.FC<EventChecklistProps> = ({
  scenarioSessionId,
}) => {
  const {t} = useTranslate();
  const {data, isLoading} = useGetEventChecklistQuery({scenarioSessionId});

  const items = data?.eventChecklist ?? [];

  if (isLoading) {
    return <ActivityIndicator size="small" color={colors.ds.theme.primary} />;
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>{t('learn.evaluationChecklist')}</Text>
      </View>
      <View style={styles.itemsContainer}>
        {items.map(item => (
          <View
            key={item.id}
            style={[
              styles.checklistItem,
              item.hasOccurred ? styles.itemCompleted : styles.itemIncomplete,
            ]}>
            {item.hasOccurred ? (
              <CheckCircleIcon width={ms(19)} height={ms(19)} />
            ) : (
              <CancelIcon width={ms(19)} height={ms(19)} />
            )}
            <Text style={styles.itemText}>{item.name}</Text>
          </View>
        ))}
      </View>
    </>
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
    color: colors.ds.typography.mediumEmphasis,
  },
  itemsContainer: {
    gap: '12@ms',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
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
    borderColor: colors.ds.green[200],
  },
  itemIncomplete: {
    backgroundColor: colors.lightRed,
    borderColor: colors.ds.red[200],
  },
});
