import reducer, {clearCurrentChat, setCurrentChat} from '@/store/slices/chatSlice';
import {AllyPlatforms} from '@/constants';
import {Chat, ChatProvider, ChatStatus, MessageType, User, UserRole} from '@/types';

const mockUser = (id: number): User => ({
  email: `user${id}@example.com`,
  id,
  name: `User ${id}`,
  phone: '1234567890',
  role: UserRole.CLIENT,
  userId: id,
});

const mockChat: Chat = {
  chatId: 10,
  client: mockUser(1),
  clientId: 1,
  counselor: mockUser(2),
  counselorId: 2,
  endedAt: null,
  messages: [
    {
      chatId: 10,
      content: 'hello',
      createdAt: new Date().toISOString(),
      id: 1,
      senderId: 1,
      type: MessageType.TEXT,
    },
  ],
  startedAt: new Date().toISOString(),
  status: ChatStatus.ACTIVE,
  provider: ChatProvider.MICROPHONE,
  platform: AllyPlatforms.MOBILE,
};

describe('chatSlice reducers', () => {
  it('should return initial state', () => {
    const state = reducer(undefined, {type: 'unknown'} as any);
    expect(state.currentChat).toBeNull();
  });

  it('setCurrentChat should set current chat', () => {
    const next = reducer(undefined, setCurrentChat(mockChat));
    expect(next.currentChat).toEqual(mockChat);
  });

  it('clearCurrentChat should reset current chat', () => {
    const withChat = reducer(undefined, setCurrentChat(mockChat));
    const cleared = reducer(withChat, clearCurrentChat());
    expect(cleared.currentChat).toBeNull();
  });
});


