import React from 'react';
import {StatusBar, SafeAreaView} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import {Provider} from 'react-redux';

import {RootNavigator} from '@/navigation/RootNavigator';
import {store} from '@/store';

export const App = (): React.JSX.Element => {
  return (
    <Provider store={store}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#F5FCFF" />
        <RootNavigator />
      </SafeAreaView>
    </Provider>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
