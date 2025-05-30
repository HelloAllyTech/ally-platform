import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

const styles = ScaledSheet.create({
  fieldValueText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.lightGray3,
  },
});

export default styles;
