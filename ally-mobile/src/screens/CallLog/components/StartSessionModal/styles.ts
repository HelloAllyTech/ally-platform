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
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    right: '7@ms',
    top: '5@ms',
    padding: '6@ms',
    zIndex: 1,
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
  ctaBtn: {
    paddingHorizontal: '20@ms',
    width: '80%',
    alignSelf: 'center',
  },
  consent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.darkGray16,
    textAlign: 'center',
    marginTop: '16@mvs',
  },
  marginB16: {
    marginBottom: '16@mvs',
  },
  secondaryButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#007AFF',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#007AFF',
  },
});
