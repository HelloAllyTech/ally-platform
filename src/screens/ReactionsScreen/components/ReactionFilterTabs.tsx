import React, {useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {FlatList, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker/utils';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReactionFilterTabsProps} from '../types';

interface TabData {
  reaction: string | null;
  label: string;
  isSelected: boolean;
}

export const ReactionFilterTabs: React.FC<ReactionFilterTabsProps> = ({
  summary,
  selectedReaction,
  totalCount,
  onFilterChange,
}) => {
  const {t} = useTranslation();

  const tabs = useMemo<TabData[]>(() => {
    const allTab: TabData = {
      reaction: null,
      label: `${t('achievements.filters.all')} ${totalCount}`,
      isSelected: selectedReaction === null,
    };

    const reactionTabs: TabData[] = summary.map(item => ({
      reaction: item.reaction,
      label: `${item.count}`,
      isSelected: selectedReaction === item.reaction,
    }));

    return [allTab, ...reactionTabs];
  }, [summary, selectedReaction, totalCount, t]);

  const renderTab = useCallback(
    ({item}: {item: TabData}) => {
      // "All" tab - text style with underline indicator
      if (!item.reaction) {
        return (
          <TouchableOpacity
            style={styles.filterTab}
            onPress={() => onFilterChange(null)}
            activeOpacity={0.7}>
            <Text
              style={[
                styles.allTabLabel,
                item.isSelected && styles.allTabLabelSelected,
              ]}>
              {item.label}
            </Text>
            {item.isSelected && <View style={styles.filterIndicator} />}
          </TouchableOpacity>
        );
      }

      // Reaction tabs - emoji in bubble, count outside
      return (
        <TouchableOpacity
          style={styles.filterTab}
          onPress={() => onFilterChange(item.reaction)}
          activeOpacity={0.7}>
          <View style={styles.filterContent}>
            <View style={styles.emojiBubble}>
              <Text style={styles.tabEmoji}>
                {EMOJI_UNICODE_MAP[item.reaction.toLowerCase()]}
              </Text>
            </View>
            <Text style={styles.tabCount}>{item.label}</Text>
          </View>
          {item.isSelected && <View style={styles.filterIndicator} />}
        </TouchableOpacity>
      );
    },
    [onFilterChange],
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={tabs}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item.reaction || 'all'}
        renderItem={renderTab}
        contentContainerStyle={styles.content}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.white,
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  content: {
    paddingHorizontal: '20@ms',
    paddingTop: '16@ms',
    gap: '16@ms',
  },
  filterTab: {
    alignItems: 'center',
    position: 'relative',
    paddingBottom: '12@ms',
  },
  filterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  filterIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: '3@ms',
    backgroundColor: colors.azureBlue,
    borderTopLeftRadius: '2@ms',
    borderTopRightRadius: '2@ms',
  },
  allTabLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '4@ms',
  },
  allTabLabelSelected: {
    color: colors.azureBlue,
    fontWeight: fontWeights.medium,
  },
  emojiBubble: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    backgroundColor: colors.white,
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabEmoji: {
    fontSize: '16@ms',
  },
  tabCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
