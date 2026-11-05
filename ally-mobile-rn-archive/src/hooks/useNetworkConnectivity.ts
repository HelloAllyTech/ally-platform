import {useEffect, useState} from 'react';
import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

interface NetworkState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/**
 * useNetworkConnectivity
 *
 * Custom hook to track network connectivity state.
 * Returns:
 * - isConnected: whether the device has *any* network connection
 * - isInternetReachable: whether the internet is actually reachable
 * - isOffline: derived state → true if either of the above is false
 */
export const useNetworkConnectivity = () => {
  const [state, setState] = useState<NetworkState>({
    isConnected: null,
    isInternetReachable: null,
  });

  useEffect(() => {
    // Subscribe to network state updates
    const unsubscribe = NetInfo.addEventListener((netState: NetInfoState) => {
      setState({
        isConnected: netState.isConnected,
        isInternetReachable: netState.isInternetReachable ?? null,
      });
    });

    // Fetch initial state once on mount
    NetInfo.fetch().then(netState => {
      setState({
        isConnected: netState.isConnected,
        isInternetReachable: netState.isInternetReachable ?? null,
      });
    });

    return () => unsubscribe();
  }, []);

  /**
   * Offline = either no connection at all,
   * or connected to a network but no internet access.
   */
  const isOffline =
    state.isConnected === false || state.isInternetReachable === false;

  return {
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
    isOffline,
  };
};
