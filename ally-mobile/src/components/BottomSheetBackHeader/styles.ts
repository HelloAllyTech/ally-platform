import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '24@s',
    paddingTop: '8@vs',
    paddingBottom: '8@mvs',
    position: 'relative',
  },
  backButton: {
    padding: '8@s',
    marginLeft: '-8@s',
    zIndex: 1,
  },
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '18@ms',
    lineHeight: '32@ms',
    color: colors.ds.typography.highEmphasis,
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  headerSpacer: {
    width: '28@s',
    zIndex: 1,
  },
});
