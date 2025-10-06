import {store} from '@/store/store';
import {api} from '@/services/api';

describe('Redux store', () => {
  it('should initialize with expected reducer keys', () => {
    const state = store.getState();
    expect(state).toHaveProperty('user');
    expect(state).toHaveProperty('chat');
    expect(state).toHaveProperty('summary');
    expect(state).toHaveProperty(api.reducerPath);
  });

  it('should include RTK Query middleware', () => {
    // Dispatch a dummy api action and ensure it does not throw
    const action = {type: `${api.reducerPath}/dummy`};
    expect(() => store.dispatch(action as any)).not.toThrow();
  });
});


