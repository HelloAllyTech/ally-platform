import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '16@s',
  },
  header: {
    paddingHorizontal: '16@s',
    paddingVertical: '16@vs',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray7,
    marginBottom: '12@vs',
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontWeight: fontWeights.semiBold,
    color: colors.ds.typography.highEmphasis,
  },
  headerSubtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '4@vs',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '48@vs',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.lowEmphasis,
    textAlign: 'center',
  },
  loadingContainer: {
    paddingVertical: '32@vs',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentItemContainer: {
    marginBottom: '12@vs',
  },
  footerLoader: {
    paddingVertical: '16@vs',
    alignItems: 'center',
  },
  contentContainer: {
    paddingHorizontal: '16@s',
    paddingBottom: '24@vs',
  },
});
