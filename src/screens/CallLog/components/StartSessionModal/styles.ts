import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '16@ms',
  },
  container: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    paddingVertical: '16@mvs',
    paddingHorizontal: '20@ms',
    width: '85%',
  },
  closeBtn: {
    position: 'absolute',
    right: '7@ms',
    top: '5@ms',
    padding: '6@ms',
    zIndex: 1,
  },
  closeText: {
    fontSize: '25@ms',
    fontWeight: '400',
    color: colors.darkSlate,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '20@ms',
    color: colors.darkGray12,
    textAlign: 'center',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  illustration: {
    width: '180@ms',
    height: '120@vs',
    alignSelf: 'center',
    marginVertical: '12@mvs',
    resizeMode: 'contain',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '20@ms',
    color: colors.darkGray2,
    textAlign: 'center',
    marginBottom: '16@mvs',
    marginHorizontal: '23@ms',
  },
  sectionLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.darkGray2,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '10@mvs',
  },
  radioOuter: {
    width: '16@ms',
    height: '16@ms',
    borderRadius: '9@ms',
    borderWidth: 1,
    borderColor: colors.lightGray5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '12@ms',
    alignSelf: 'center',
  },
  radioInner: {
    width: '10@ms',
    height: '10@ms',
    borderRadius: '5@ms',
    backgroundColor: colors.blue,
  },
  optionTextBlock: {
    flex: 1,
  },
  optionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.darkGray12,
  },
  optionSubtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.charcoal2,
    marginTop: '2@mvs',
  },
  ctaBtn: {
    paddingHorizontal: '20@ms',
    width: '80%',
    alignSelf: 'center',
  },
  ctaBtnDisabled: {
    backgroundColor: colors.lightGray4,
  },
  ctaText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.white,
    fontSize: '14@ms',
  },
  consent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.darkGray16,
    textAlign: 'center',
    marginTop: '16@mvs',
  },
  separator: {
    height: 0.7,
    backgroundColor: colors.lightGray5,
    marginTop: '7@mvs',
  },
  marginB16: {
    marginBottom: '16@mvs',
  },
  singleOptionRow: {
    paddingVertical: '16@mvs',
    justifyContent: 'center',
  },
  singleOptionTextBlock: {
    alignItems: 'center',
  },
});
