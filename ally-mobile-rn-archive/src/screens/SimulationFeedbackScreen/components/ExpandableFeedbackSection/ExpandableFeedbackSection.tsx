import React, {useCallback, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {FeedbackItem} from '@/types';

import {RecommendationBox} from '../RecommendationBox';

interface ExpandableFeedbackSectionProps {
  title: string;
  items: (string | FeedbackItem)[];
  collapsedItemCount?: number;
  /**
   * True while the summary/translation for the active language is still being
   * generated server-side. Shows "Generating your feedback…" instead of the
   * empty state (web parity — SkillsTab/FeedbackSection).
   */
  isGenerating?: boolean;
}

const normalizeItem = (item: string | FeedbackItem): FeedbackItem =>
  typeof item === 'string' ? {text: item} : item;

export const ExpandableFeedbackSection: React.FC<
  ExpandableFeedbackSectionProps
> = ({title, items, collapsedItemCount = 3, isGenerating = false}) => {
  const {t} = useTranslate();
  const [isExpanded, setIsExpanded] = useState(false);

  const displayItems = isExpanded ? items : items.slice(0, collapsedItemCount);

  const renderFeedbackItem = useCallback(
    (rawItem: string | FeedbackItem, index: number) => {
      const item = normalizeItem(rawItem);
      return (
        <View key={index} style={styles.itemGroup}>
          <View style={styles.itemRow}>
            <Text style={styles.bullet}>{'\u2022'}</Text>
            <Text style={styles.itemText}>{item.text}</Text>
          </View>
          {!!item.recommendation && (
            <RecommendationBox recommendation={item.recommendation} />
          )}
        </View>
      );
    },
    [],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.content}>
        {displayItems.length > 0 ? (
          displayItems.map(renderFeedbackItem)
        ) : (
          <Text style={styles.noDataText}>
            {isGenerating
              ? t('postSim.feedback.generating')
              : t('postSim.feedback.noData')}
          </Text>
        )}
        {items.length > collapsedItemCount && (
          <TouchableOpacity
            style={styles.viewMoreButton}
            onPress={() => setIsExpanded(prev => !prev)}>
            <Text style={styles.viewMoreText}>
              {isExpanded ? t('common.viewLess') : t('common.viewMore')}
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
  itemGroup: {
    gap: '8@vs',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: '8@ms',
  },
  bullet: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    color: colors.black,
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
