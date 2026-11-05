import RNFS from 'react-native-fs';

import {saveFile} from '../fileOperations';

jest.mock('@/constants/general', () => ({
  isIOS: false,
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
  Dimensions: {
    get: jest.fn(
      dim =>
        ({
          window: {
            width: 375,
            height: 812,
            scale: 1,
            fontScale: 1,
          },
          screen: {
            width: 375,
            height: 812,
            scale: 1,
            fontScale: 1,
          },
        })[dim],
    ),
    set: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
}));

jest.mock('react-native-fs', () => {
  let documentDirectoryPath = '/mock/documents';
  return {
    get DocumentDirectoryPath() {
      return documentDirectoryPath;
    },
    set DocumentDirectoryPath(value) {
      documentDirectoryPath = value;
    },
    get DownloadDirectoryPath() {
      return documentDirectoryPath ? '/mock/downloads' : undefined;
    },
    exists: jest.fn().mockResolvedValue(false),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    scanFile: jest.fn().mockResolvedValue(undefined),
  };
});

const t = jest.fn().mockImplementation(key => key);

describe('saveFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('should save a file and return the file path', async () => {
    // On Android, it should use DownloadDirectoryPath
    const filePath = await saveFile({
      content: 'Test content',
      chatId: 123,
      t,
    });
    expect(filePath).toContain('/mock/downloads/call-summary-123-');
    expect(filePath).toContain('.txt');
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      'Test content',
      'utf8',
    );
  });

  it('should create directory if it does not exist', async () => {
    // Mock isIOS as true for this test
    const generalModule = require('@/constants/general');
    const originalIsIOS = generalModule.isIOS;
    Object.defineProperty(generalModule, 'isIOS', {get: () => true});

    // Mock exists to return false to trigger directory creation
    (RNFS.exists as unknown as jest.Mock).mockResolvedValueOnce(false);

    await saveFile({
      content: 'Test content',
      chatId: 123,
      t,
    });

    expect(RNFS.exists).toHaveBeenCalledWith('/mock/documents/CallSummary');
    expect(RNFS.mkdir).toHaveBeenCalledWith('/mock/documents/CallSummary');

    // Restore isIOS
    Object.defineProperty(generalModule, 'isIOS', {get: () => originalIsIOS});
  });

  it('should throw an error if directory is not set', async () => {
    // Mock DownloadDirectoryPath as undefined since we're on Android (isIOS = false)
    const originalDownloadPath = RNFS.DownloadDirectoryPath;
    Object.defineProperty(RNFS, 'DownloadDirectoryPath', {
      get: () => undefined,
    });

    await expect(
      saveFile({
        content: 'Test content',
        chatId: 123,
        t,
      }),
    ).rejects.toThrow('callSummary.info.directoryPathError');

    // Restore the original value
    Object.defineProperty(RNFS, 'DownloadDirectoryPath', {
      get: () => originalDownloadPath,
    });
  });
});
