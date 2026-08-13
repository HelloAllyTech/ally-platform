import {StatusBar} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import {Provider} from 'react-redux';

import {ErrorBoundary, NetworkLogs, ToastProvider} from '@/components';
import {env} from '@/config/env';
import {RootNavigator} from '@/navigation/RootNavigator';

import {store} from './store/store';

import './localization/i18n';

export const App = () => {
  return (
    <GestureHandlerRootView style={styles.container}>
      <Provider store={store}>
        <SafeAreaProvider style={styles.container}>
          <StatusBar translucent backgroundColor="transparent" />
          <ToastProvider>
            {/*
              Inside the providers so the fallback still has translations, theming
              and safe-area context, and so resetting re-mounts the navigator
              without discarding the store.
            */}
            <ErrorBoundary>
              <RootNavigator />
            </ErrorBoundary>
          </ToastProvider>
          {env.ENVIRONMENT === 'development' && <NetworkLogs />}
        </SafeAreaProvider>
      </Provider>
    </GestureHandlerRootView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
});
