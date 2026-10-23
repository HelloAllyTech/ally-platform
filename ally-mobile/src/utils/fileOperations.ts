import RNFS from 'react-native-fs';

import {isIOS} from '@/constants/general';
import {TranslationType} from '@/localization/locales/type';

interface SaveFileOptions {
  content: string;
  chatId: number;
  t: (key: TranslationType) => string;
}

export const saveFile = async ({
  content,
  chatId,
  t,
}: SaveFileOptions): Promise<string> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `call-summary-${chatId}-${timestamp}.txt`;
  let directory;
  if (isIOS) {
    // For iOS, save directly to the app's Documents directory
    directory = `${RNFS.DocumentDirectoryPath}/CallSummary`;
    // Create CallSummary directory if it doesn't exist
    const exists = await RNFS.exists(directory);
    if (!exists) {
      await RNFS.mkdir(directory);
    }
  } else {
    directory = RNFS.DownloadDirectoryPath;
  }

  if (!directory) {
    throw new Error(t('callSummary.info.directoryPathError'));
  }

  const filePath = `${directory}/${filename}`;
  await RNFS.writeFile(filePath, content, 'utf8');

  if (!isIOS) {
    await RNFS.scanFile(filePath);
  }

  return filePath;
};
