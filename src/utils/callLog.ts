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
      return {label: 'CallLogs.uploaded', color: colors.azureBlue};
    default:
      return {label: 'CallLogs.liveSession', color: colors.deepPurple};
  }
};
