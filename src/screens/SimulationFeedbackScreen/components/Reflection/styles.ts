import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: '16@vs',
    gap: '16@vs',
  },
  promptCard: {
    backgroundColor: '#FFFDFB',
    borderWidth: 0.5,
    borderColor: '#D4B896',
    borderRadius: '4@ms',
    padding: '24@ms',
    gap: '16@vs',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  numberBadge: {
    backgroundColor: '#8B6F47',
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBadgeText: {
    color: colors.white,
    fontSize: '14@ms',
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  promptText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '18@ms',
    color: '#81663E',
    letterSpacing: 0.25,
  },
  textInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    minHeight: '150@vs',
    textAlignVertical: 'top',
    padding: 0,
  },
});
