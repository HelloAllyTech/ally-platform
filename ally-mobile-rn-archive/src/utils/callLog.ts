import {TranslationType} from '@/localization/locales/type';
import {colors} from '@/theme';
import {ChatProvider} from '@/types';

type SourceLabelConfig = {
  label: TranslationType;
  color: string;
};

export const getLogSourceLabelConfig = (
  provider: ChatProvider,
): SourceLabelConfig => {
  switch (provider) {
    case ChatProvider.AUDIO_UPLOAD:
      return {label: 'calls.source.uploaded', color: colors.ds.blue[500]};
    default:
      return {
        label: 'calls.source.liveSession',
        color: colors.ds.deepPurple[500],
      };
  }
};
