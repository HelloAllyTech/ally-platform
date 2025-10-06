import {Platform} from 'react-native';
import {MICROPHONE_PERMISSION, USER_PERMISSIONS} from '../permissions';

jest.mock('react-native', () => ({
  Platform: {OS: 'ios'},
}));

jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {IOS: {MICROPHONE: 'IOS_MIC'}, ANDROID: {RECORD_AUDIO: 'AND_MIC'}},
}));

describe('constants/permissions', () => {
  it('defines user permissions enum', () => {
    expect(USER_PERMISSIONS.EDIT_SUMMARY).toBe('edit:summary');
  });
  it('selects microphone permission by platform (ios mocked)', () => {
    expect(MICROPHONE_PERMISSION).toBe('IOS_MIC');
  });
});
