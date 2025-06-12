import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export default ScaledSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    borderWidth: 0.7,
    borderColor: colors.lightGray14,
    paddingHorizontal: '10@s',
    paddingVertical: '10@vs',
    marginVertical: '6@vs',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '12@vs',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  categoryChip: {
    backgroundColor: colors.lightGray14,
    borderRadius: '16@ms',
    paddingHorizontal: '12@s',
    paddingVertical: '3@vs',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '8@s',
    height: '24@ms',
  },
  categoryText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.gray,
    fontSize: '12@ms',
    lineHeight: '16@ms',
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagChip: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '16@ms',
    paddingHorizontal: '12@s',
    paddingVertical: '3@vs',
    marginLeft: '8@s',
    height: '24@ms',
  },
  tagText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.gray,
    fontSize: '12@ms',
    lineHeight: '16@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    color: colors.black,
    lineHeight: '18@ms',
    marginBottom: '8@vs',
  },
  contentRow: {
    position: 'relative',
    marginBottom: '0@vs',
  },
  content: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkGray6,
    lineHeight: '18@ms',
  },
  moreButton: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: colors.whiteTransparent90,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  moreText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray6,
    fontSize: '14@ms',
    paddingLeft: '10@s',
    textDecorationLine: 'underline',
    lineHeight: '18@ms',
  },
});
