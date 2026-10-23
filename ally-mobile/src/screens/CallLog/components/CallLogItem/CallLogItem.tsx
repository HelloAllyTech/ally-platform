import {useMemo} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  DoubleBottomArrowIcon,
  DoubleRightArrowIcon,
  EyeIcon,
} from '@/assets/icons';
import {
  ChatSummaryStatus,
  DEFAULT_HIT_SLOP,
  formatSessionMode,
  LogType,
  TAG_COLORS,
} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {getLogSourceLabelConfig} from '@/utils/callLog';
import {calculateDuration, formatDate, formatTime} from '@/utils/date';

import {LogItem} from '../../types';
import {StatusBadge} from '../StatusBadge';
import {Tag} from '../Tag/Tag';

/**
 * Props interface for the CallLogItem component
 * @interface CallLogItemProps
 * @property {LogItem} item - The call log or simulation log data to display
 * @property {boolean} expanded - Whether the item is expanded or collapsed
 * @property {() => void} onToggle - Callback function to toggle expanded state
 */
interface CallLogItemProps {
  item: LogItem;
  expanded: boolean;
  disabled?: boolean;
  logType: LogType;
  onToggle: () => void;
  onItemPress: () => void;
}

/**
 * CallLogItem Component
 *
 * Renders a single call log entry that can be expanded to show additional details.
 * The component displays client information, call quality score, and when expanded,
 * shows the call duration and associated tags with color-coded positivity ratings.
 */
export const CallLogItem = ({
  item,
  expanded,
  logType,
  disabled = false,
  onToggle,
  onItemPress,
}: CallLogItemProps) => {
  const {t} = useTranslate();
  const logTitle = useMemo(
    () =>
      item?.details?.callInfo?.summaryName ||
      item?.metadata?.sessionName ||
      item?.details?.chatId ||
      `ID-${item.id}`,
    [
      item?.details?.callInfo?.summaryName,
      item?.details?.chatId,
      item.id,
      item?.metadata?.sessionName,
    ],
  );
  const tags = item.details?.summary?.tags || [];
  const provider = item.details?.callInfo?.provider;

  return (
    <TouchableOpacity
      disabled={disabled}
      activeOpacity={0.7}
      onPress={onItemPress}
      style={styles.logItemContainer}>
      <View style={[styles.logHeader, expanded && styles.expandedLogHeader]}>
        <View style={styles.leftContainer}>
          <View style={styles.logHeaderContent}>
            <TouchableOpacity
              onPress={onToggle}
              activeOpacity={0.7}
              hitSlop={DEFAULT_HIT_SLOP}
              style={styles.arrowContainer}>
              {expanded ? (
                <DoubleBottomArrowIcon width={16} height={16} />
              ) : (
                <DoubleRightArrowIcon width={16} height={16} />
              )}
            </TouchableOpacity>
            <View style={styles.titleRow}>
              <View style={styles.colShrink}>
                <Text
                  style={styles.logId}
                  numberOfLines={1}
                  ellipsizeMode="tail">
                  {logTitle}
                </Text>
              </View>

              <View style={styles.statusAndEyeContainer}>
                <StatusBadge
                  status={
                    item.summaryStatus || (item.status as ChatSummaryStatus)
                  }
                />
                {!disabled && (
                  <EyeIcon width={16} height={16} style={styles.eyeIcon} />
                )}
              </View>
            </View>
          </View>
          {[LogType.REAL, LogType.ARCHIVED_REAL].includes(logType) ? (
            <Text style={styles.logDate}>
              {formatDate(item.startedAt)} • {formatTime(item.startedAt)}
            </Text>
          ) : (
            logType === LogType.SIMULATION && (
              <Text
                style={styles.scenarioName}
                numberOfLines={1}
                ellipsizeMode="tail">
                {item?.scenario?.title || ''}
                {` • ${formatDate(item.startedAt)}`}
              </Text>
            )
          )}
        </View>
      </View>

      {/* Expanded details section */}
      {expanded && (
        <View style={styles.logDetails}>
          <View style={styles.durationRow}>
            {provider && (
              <>
                <Text
                  style={[
                    styles.sourceText,
                    {color: getLogSourceLabelConfig(provider).color},
                  ]}>
                  {t(getLogSourceLabelConfig(provider).label)}
                </Text>
                <Text style={styles.separator}>|</Text>
              </>
            )}
            <Text style={styles.duration}>
              {`${t('common.duration')}: ${calculateDuration(item.startedAt, item.endedAt)}`}
              {item?.score
                ? ` • ${t('calls.table.sessionScore')}: ${item?.score}`
                : ''}
              {item?.details?.callInfo?.mode
                ? ` • ${t('calls.table.mode')}: ${formatSessionMode(item.details.callInfo.mode, t)}`
                : ''}
            </Text>
          </View>
          {/* Render tags if they exist */}
          {(tags?.length ?? 0) > 0 && (
            <View style={styles.tagsRow}>
              {tags?.map?.((tagItem, idx) => {
                // positivity_rating is expected to be an integer 1-5, but the
                // AI sometimes emits out-of-range or fractional values (e.g.
                // 0.3). TAG_COLORS only has keys 1-5, so an unnormalised lookup
                // returns undefined and reading .bg/.text crashed the screen.
                // Normalise to the nearest valid key and keep a neutral fallback.
                const rawRating = Number(tagItem.positivity_rating ?? 5);
                const ratingKey = Number.isFinite(rawRating)
                  ? Math.min(5, Math.max(1, Math.round(rawRating)))
                  : 5;
                const tagColor =
                  TAG_COLORS[ratingKey as keyof typeof TAG_COLORS] ??
                  TAG_COLORS[3];
                return (
                  <Tag
                    key={idx}
                    label={tagItem.tag || ''}
                    color={tagColor.bg}
                    textColor={tagColor.text}
                  />
                );
              })}
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

// Styles for the component
const styles = ScaledSheet.create({
  logItemContainer: {
    backgroundColor: colors.white,
    marginHorizontal: '14@ms',
    paddingHorizontal: '10@ms',
    paddingVertical: '10@ms',
    borderBottomWidth: 1,
    borderColor: colors.lightGray2,
  },
  leftContainer: {
    flex: 1,
    marginRight: '10@ms',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: '12@ms',
    padding: '8@ms',
    marginTop: '-2@ms',
    marginBottom: '2@ms',
  },
  expandedLogHeader: {
    backgroundColor: colors.lightGray,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '2@ms',
  },
  logHeaderContent: {
    flexDirection: 'row',
    flexShrink: 1,
  },
  colShrink: {
    flexDirection: 'column',
    flexShrink: 1,
  },
  arrowContainer: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4@ms',
  },
  textContainer: {
    flex: 1,
  },
  logId: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.label.large,
    color: colors.ds.typography.highEmphasis,
    flexShrink: 1,
    marginRight: '3@ms',
  },
  scenarioName: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.darkCharcoal,
    flexShrink: 1,
    marginRight: '3@ms',
    marginLeft: '30@ms',
  },
  logDate: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginLeft: '30@ms',
  },
  logDetails: {
    marginTop: '6@ms',
    marginLeft: '4@ms',
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '8@ms',
  },
  separator: {
    color: colors.ds.stroke.primary,
    marginHorizontal: '4@ms',
  },
  duration: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  sourceText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: '8@ms',
  },
  eyeIcon: {
    marginLeft: '10@ms',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '95%',
    marginRight: '20@ms',
  },
  statusAndEyeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
