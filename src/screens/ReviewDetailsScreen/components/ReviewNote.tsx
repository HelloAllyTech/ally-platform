import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EditSquareIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, typography} from '@/theme';

interface ReviewNoteProps {
  note: string;
  onEditNote?: () => void;
}

export const ReviewNote: React.FC<ReviewNoteProps> = ({note, onEditNote}) => {
  const {t} = useTranslate();
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {t('SimulationFeedback.reviewNoteTitle')}
        </Text>
        {onEditNote && (
          <TouchableOpacity onPress={onEditNote} style={styles.editButton}>
            <EditSquareIcon width={16} height={16} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.ds.orange[50],
    paddingHorizontal: '16@ms',
    paddingVertical: '12@ms',
    borderLeftWidth: 1,
    borderLeftColor: colors.ds.orange[400],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    color: colors.ds.orange[900],
  },
  editButton: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 0.5,
    backgroundColor: colors.ds.neutral.white,
    borderColor: colors.ds.stroke.primary,
  },
  note: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
