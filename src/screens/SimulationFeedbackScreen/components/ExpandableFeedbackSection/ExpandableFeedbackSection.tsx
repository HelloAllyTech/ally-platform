import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface ExpandableFeedbackSectionProps {
  title: string;
  items: string[];
  collapsedItemCount?: number;
}

export const ExpandableFeedbackSection: React.FC<
  ExpandableFeedbackSectionProps
> = ({title, items, collapsedItemCount = 3}) => {
  const {t} = useTranslate();
  const [isExpanded, setIsExpanded] = useState(false);

  const displayItems = isExpanded ? items : items.slice(0, collapsedItemCount);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.content}>
        {displayItems.length > 0 ? (
          displayItems.map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.noDataText}>
            {t('SimulationFeedback.noDataAvailable')}
          </Text>
        )}
        {items.length > collapsedItemCount && (
          <TouchableOpacity
            style={styles.viewMoreButton}
            onPress={() => setIsExpanded(prev => !prev)}>
            <Text style={styles.viewMoreText}>
              {isExpanded ? t('Common.viewLess') : t('Common.viewMore')}
            </Text>
            <ArrowDown
              width={10}
              height={10}
              color={colors.black}
              style={isExpanded ? styles.arrowRotated : undefined}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.deepPurple[300],
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    marginTop: '16@vs',
  },
  header: {
    backgroundColor: colors.ds.deepPurpleAlpha[50],
    paddingHorizontal: '16@ms',
    paddingVertical: '8@vs',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
  },
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: '0.25@ms',
    color: colors.ds.typography.highEmphasis,
  },
  content: {
    padding: '16@ms',
    gap: '16@vs',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.lightGray,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: '8@ms',
  },
  itemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: '0.25@ms',
    color: colors.black,
    flex: 1,
  },
  noDataText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  viewMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  arrowRotated: {
    transform: [{rotate: '180deg'}],
  },
});
