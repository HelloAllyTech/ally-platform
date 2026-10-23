import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    marginRight: '16@ms',
  },
  headerTitle: {
    flex: 1,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
    fontWeight: '400',
  },
  headerSpacer: {
    width: '24@ms',
  },
  markAllText: {
    ...typography.body.small,
    color: colors.ds.theme.primary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '24@ms',
  },
  emptyText: {
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  item: {
    paddingHorizontal: '21@ms',
    paddingVertical: '12@ms',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  itemUnread: {
    backgroundColor: colors.ds.grey[50],
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  unreadDot: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.theme.primary,
    marginTop: '6@ms',
    marginRight: '8@ms',
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    fontWeight: '600',
  },
  itemBody: {
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '2@ms',
  },
  itemTime: {
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
    marginTop: '4@ms',
  },
});
