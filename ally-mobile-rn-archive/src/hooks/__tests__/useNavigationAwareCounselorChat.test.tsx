import React from 'react';
import {NavigationContainerRef} from '@react-navigation/native';
import {Text} from 'react-native';
import {render, act} from '@testing-library/react-native';

import {useNavigationAwareCounselorChat} from '../useNavigationAwareCounselorChat';
import {SCREEN_NAMES} from '@/constants';

const mockReset = jest.fn();
const mockNavigate = jest.fn();
jest.mock('../useAppNavigation', () => ({
  useAppNavigation: () => ({reset: mockReset, navigate: mockNavigate}),
}));

const mockUseCounselorChat = jest.fn(() => ({checkCounselorChat: jest.fn()}));
jest.mock('../useCounselorChat', () => ({
  useCounselorChat: (...args: any[]) => (mockUseCounselorChat as any)(...args),
}) as any);

describe('useNavigationAwareCounselorChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('subscribes to nav state and composes useCounselorChat', () => {
    const ref: any = {
      addListener: jest.fn(() => jest.fn()),
      getCurrentRoute: jest.fn(() => ({key: 'k', name: SCREEN_NAMES.CALL_LOG})),
    } satisfies Partial<NavigationContainerRef<any>>;

    const Test = () => {
      useNavigationAwareCounselorChat(ref);
      return <Text>ok</Text>;
    };

    render(<Test />);
    expect(ref.addListener).toHaveBeenCalled();
    expect(mockUseCounselorChat).toHaveBeenCalled();
  });

  it('navigates reset when active chat found on SPLASH', () => {
    const listeners: Record<string, Function> = {};
    const ref: any = {
      addListener: jest.fn((event: string, cb: any) => { listeners[event]=cb; return jest.fn(); }),
      getCurrentRoute: jest.fn(() => ({key: 'k', name: SCREEN_NAMES.SPLASH})),
    };

    const Test = () => {
      useNavigationAwareCounselorChat(ref);
      return <Text>ok</Text>;
    };

    render(<Test />);
    act(() => { listeners['state'] && listeners['state'](); });
    const calls: any[] = (mockUseCounselorChat as any).mock.calls as any[];
    const opts: any = calls[0]?.[0];
    opts.onActiveChatFound && opts.onActiveChatFound();
    expect(mockReset).toHaveBeenCalled();
  });

  it('navigates to LISTENING when active chat found on default route', () => {
    const listeners: Record<string, Function> = {};
    const ref: any = {
      addListener: jest.fn((event: string, cb: any) => { listeners[event]=cb; return jest.fn(); }),
      getCurrentRoute: jest.fn(() => ({key: 'k', name: SCREEN_NAMES.CALL_LOG})),
    };

    const Test = () => {
      useNavigationAwareCounselorChat(ref);
      return <Text>ok</Text>;
    };

    render(<Test />);
    act(() => { listeners['state'] && listeners['state'](); });
    const calls: any[] = (mockUseCounselorChat as any).mock.calls as any[];
    const opts: any = calls[0]?.[0];
    opts.onActiveChatFound && opts.onActiveChatFound();
    expect(mockNavigate).toHaveBeenCalled();
  });
});


