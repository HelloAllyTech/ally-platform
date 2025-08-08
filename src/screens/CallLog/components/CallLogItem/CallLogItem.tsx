import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  DoubleBottomArrowIcon,
  DoubleRightArrowIcon,
  EyeIcon,
} from '@/assets/icons';
import {DEFAULT_HIT_SLOP, TAG_COLORS} from '@/constants';
import {colors, fontFamily} from '@/theme';
import {calculateDuration, formatDate, formatTime} from '@/utils/date';

import {CallLog} from '../../types';
import {Tag} from '../Tag/Tag';

/**
 * Props interface for the CallLogItem component
 * @interface CallLogItemProps
 * @property {CallLog} item - The call log data to display
 * @property {boolean} expanded - Whether the item is expanded or collapsed
 * @property {() => void} onToggle - Callback function to toggle expanded state
 */
interface CallLogItemProps {
  item: CallLog;
  expanded: boolean;
  disabled?: boolean;
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
  disabled = false,
  onToggle,
  onItemPress,
}: CallLogItemProps) => {
  return (
    <TouchableOpacity
      disabled={disabled}
      activeOpacity={0.7}
      onPress={onItemPress}
      style={[styles.logItemContainer, disabled && styles.disabled]}>
      {/* Header section with client info and call quality score */}
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
            <View>
              <Text style={styles.logId}>
                {item?.details?.callInfo?.summaryName || item?.details?.chatId}
              </Text>
            </View>
          </View>
          <Text style={styles.logDate}>
            {formatDate(item.startedAt)} • {formatTime(item.startedAt)}
          </Text>
        </View>
        <View style={styles.rightContainer}>
          {/* <Badge>{item.details?.summary?.callQuality || 0} Pts</Badge> */}
          {!disabled && (
            <EyeIcon width={16} height={16} style={styles.eyeIcon} />
          )}
        </View>
      </View>

      {/* Expanded details section */}
      {expanded && (
        <View style={styles.logDetails}>
          <Text style={styles.duration}>
            Duration: {calculateDuration(item.startedAt, item.endedAt)}
          </Text>
          {/* Render tags if they exist */}
          {(item.details?.summary?.tags?.length ?? 0) > 0 && (
            <View style={styles.tagsRow}>
              {item.details?.summary?.tags?.map?.((tagItem, idx) => {
                const rating = tagItem.positivity_rating ?? 5;
                const tagColor = TAG_COLORS[rating as keyof typeof TAG_COLORS];
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
  disabled: {
    opacity: 0.6,
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
    alignItems: 'center',
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
    fontSize: '14@ms',
    color: colors.black,
  },
  logDate: {
    fontSize: '12@ms',
    color: colors.darkCharcoal,
    marginLeft: '30@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  logDetails: {
    marginTop: '6@ms',
    marginLeft: '4@ms',
  },
  duration: {
    color: colors.darkCharcoal,
    fontSize: '12@ms',
    marginBottom: '8@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
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
});
