import {Dimensions, Platform} from 'react-native';

export const DEFAULT_HIT_SLOP = {
  top: 10,
  bottom: 10,
  left: 10,
  right: 10,
};

export const SCREEN_WIDTH = Dimensions.get('window').width;

export const isIOS = Platform.OS === 'ios';
