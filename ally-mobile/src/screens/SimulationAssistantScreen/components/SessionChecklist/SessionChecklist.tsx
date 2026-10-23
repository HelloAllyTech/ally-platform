import React, {FC, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import Animated, {FadeIn, FadeOut, Layout} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {ChecklistIcon, ChevronDown, TickIcon} from '@/assets/icons';
// Using best guess icons
import {fontFamily} from '@/theme';
import {ChecklistItem, ChecklistType} from '@/types';

export interface SessionChecklistProps {
  mode: ChecklistType;
  items: ChecklistItem[];
  triggeredEvents: string[];
  /**
   * Suppresses the internal title/progress header — used when a parent
   * screen renders its own tab bar (e.g. a "Checklist" tab) rather than
   * nesting a second header inside the tab content.
   */
  hideHeader?: boolean;
}

const CollapsibleContent: FC<{
  expanded: boolean;
  children: React.ReactNode;
}> = ({expanded, children}) => {
  // Simple collapsible implementation
  // For smoother animation with unknown height, we might need measuring or LayoutAnimation
  // but let's try a simple conditional render with entry/exit animation for now
  // or wrap in an Animated.View that animates height.
  // Given Reanimated v3, we can just use layout animations on the container if the item is removed/added.
  if (!expanded) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={styles.collapsibleContent}>
      {children}
    </Animated.View>
  );
};

export const SessionChecklist: FC<SessionChecklistProps> = ({
  mode,
  items,
  triggeredEvents,
  hideHeader = false,
}) => {
  const {t} = useTranslation();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(
    {},
  );

  const sortedItems = useMemo(() => {
    const events = [...items];
    return events.sort((a, b) => {
      const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;

      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return 0;
    });
  }, [items]);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({...prev, [id]: !prev[id]}));
  };

  if (mode === ChecklistType.OFF) {
    return null;
  }

  const completedCount = sortedItems.filter(item =>
    item.id ? triggeredEvents.includes(item.id) : false,
  ).length;
  const totalCount = sortedItems.length;

  return (
    <Animated.View
      layout={Layout} // Animates layout changes
      entering={FadeIn}
      style={styles.container}
      testID="session-checklist">
      {/* Header */}
      {!hideHeader && (
        <View
          style={[
            styles.header,
            mode === ChecklistType.LIST && styles.headerList,
          ]}>
          <View
            style={
              mode === ChecklistType.LIST
                ? styles.headerIconContainerList
                : styles.headerIconContainer
            }>
            <ChecklistIcon width={40} height={40} color="white" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>
              {t('simulationPage.sessionChecklist')}
            </Text>
            {mode !== ChecklistType.LIST && (
              <Text style={styles.headerSubtitle}>
                {t('simulationPage.progress')}:{' '}
                <Text style={styles.progressCompleted}>{completedCount}</Text>{' '}
                of{' '}
                <Text style={styles.progressTotal}>
                  {totalCount} {t('simulationPage.completed')}
                </Text>
              </Text>
            )}
          </View>
        </View>
      )}

      {/* List */}
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={styles.listContentContainer}
        showsVerticalScrollIndicator>
        {sortedItems.map((item, index) => {
          const itemId = item.id || `item-${index}`;
          const isTriggered = item.id
            ? triggeredEvents.includes(item.id)
            : true;
          const isExpanded = !!expandedItems[itemId];
          // Guided/List mode: Show Name. Unguided mode: Show Name if triggered, otherwise show rank.
          const displayText =
            mode === ChecklistType.GUIDED || mode === ChecklistType.LIST
              ? item.name
              : isTriggered
                ? item.name
                : (item.rank ?? '');

          return (
            <Animated.View
              key={itemId}
              layout={Layout.springify()}
              style={styles.itemContainer}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.itemHeader}
                onPress={() => toggleExpand(itemId)}
                disabled={
                  (mode !== ChecklistType.GUIDED &&
                    mode !== ChecklistType.LIST) ||
                  !item.message
                }>
                <View style={styles.itemLeft}>
                  {/* Status Circle (hidden in LIST mode) */}
                  {mode !== ChecklistType.LIST && (
                    <View
                      style={[
                        styles.statusCircle,
                        isTriggered
                          ? styles.statusCircleTriggered
                          : styles.statusCircleUntriggered,
                      ]}>
                      <TickIcon
                        width={14}
                        height={14}
                        color={isTriggered ? 'black' : '#25272a'}
                      />
                    </View>
                  )}
                  {/* Title */}
                  <Text style={styles.itemTitle}>{displayText}</Text>
                </View>

                {/* Chevron */}
                {(mode === ChecklistType.GUIDED ||
                  mode === ChecklistType.LIST) &&
                  item.message && (
                    <View
                      style={[
                        styles.chevronContainer,
                        {
                          transform: [{rotate: isExpanded ? '180deg' : '0deg'}],
                        },
                      ]}>
                      <ChevronDown width={12} height={12} color="white" />
                    </View>
                  )}
              </TouchableOpacity>

              {/* Description (Guided / List) */}
              {(mode === ChecklistType.GUIDED ||
                mode === ChecklistType.LIST) && (
                <CollapsibleContent expanded={isExpanded}>
                  {item.message && (
                    <Text style={styles.itemMessage}>{item.message}</Text>
                  )}
                </CollapsibleContent>
              )}
            </Animated.View>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: '#1d2020',
    borderRadius: '8@ms',
    padding: '10@ms',
    width: '100%',
    overflow: 'hidden',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: '24@vs',
    paddingLeft: '4@ms',
  },
  headerList: {
    alignItems: 'center',
  },
  headerIconContainer: {
    marginTop: '4@vs',
    marginRight: '16@ms',
  },
  headerIconContainerList: {
    marginRight: '16@ms',
  },
  headerTextContainer: {
    flexDirection: 'column',
  },
  headerTitle: {
    fontSize: '18@ms',
    fontWeight: '500',
    color: 'white',
    lineHeight: '22@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  headerSubtitle: {
    fontSize: '12@ms',
    color: '#9CA3AF',
    marginTop: '4@vs',
    fontStyle: 'italic',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  progressCompleted: {
    color: '#57f646',
    fontWeight: 'bold',
    fontStyle: 'italic',
  },
  progressTotal: {
    color: 'white',
    fontWeight: '500',
    fontStyle: 'italic',
  },
  listContainer: {
    flex: 1,
    paddingRight: '4@ms',
  },
  listContentContainer: {
    paddingBottom: '20@vs',
  },
  itemContainer: {
    backgroundColor: '#282B31',
    borderRadius: '16@ms',
    marginBottom: '12@vs',
    overflow: 'hidden',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16@ms',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    flex: 1,
  },
  statusCircle: {
    width: '24@ms',
    height: '24@ms',
    borderRadius: '12@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCircleTriggered: {
    backgroundColor: '#57f646',
  },
  statusCircleUntriggered: {
    backgroundColor: '#3D4045',
  },
  itemTitle: {
    fontSize: '15@ms',
    fontWeight: '500',
    color: 'white',
    marginLeft: '16@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    flex: 1,
  },
  chevronContainer: {
    opacity: 0.7,
  },
  collapsibleContent: {
    paddingHorizontal: '16@ms',
    paddingBottom: '16@ms',
    paddingLeft: '56@ms', // indenting to align with text
  },
  itemMessage: {
    fontSize: '13@ms',
    color: '#B6B5B9',
    lineHeight: '20@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});
