import {CommonActions, NavigationProp} from '@react-navigation/native';

import {SCREEN_NAMES} from '@/constants';
import {RootStackParamList} from '@/navigation/types';

const TAB_ROUTES = [
  SCREEN_NAMES.LEARN,
  SCREEN_NAMES.CALL_LOG,
  SCREEN_NAMES.USER_ANALYTICS,
  SCREEN_NAMES.SEARCH,
  SCREEN_NAMES.COMMUNITY,
] as const;

type TabRoute = (typeof TAB_ROUTES)[number];

/**
 * All these helpers need from a navigator is the ability to dispatch — that
 * is the only member any of them touches.
 *
 * Constraining to the full `NavigationProp<RootStackParamList>` rejected the
 * `NativeStackNavigationProp` that every native-stack screen actually holds:
 * React Navigation brands its navigator types with a `PrivateValueStore`
 * carrying the event map, and a native stack's event map is not the generic
 * one. Asking only for `dispatch` sidesteps a nominal check that was never
 * protecting anything here.
 */
type NavigationDispatcher = Pick<
  NavigationProp<RootStackParamList>,
  'dispatch'
>;

export const navigateToTab = <T extends NavigationDispatcher>(
  navigation: T,
  targetTab: TabRoute,
) => {
  const tabIndex = TAB_ROUTES.indexOf(targetTab);

  if (tabIndex === -1) {
    console.warn(`Tab "${targetTab}" not found in TAB_ROUTES`);
    return;
  }

  navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: SCREEN_NAMES.CALL_LOG,
          state: {
            routes: [
              {
                name: SCREEN_NAMES.BOTTOM_TABS,
                state: {
                  routes: TAB_ROUTES.map(name => ({name})),
                  index: tabIndex,
                },
              },
            ],
          },
        },
      ],
    }),
  );
};

export const navigateToLearnTab = <T extends NavigationDispatcher>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.LEARN);
};

export const navigateToCallLogTab = <T extends NavigationDispatcher>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.CALL_LOG);
};

export const navigateToCommunityTab = <T extends NavigationDispatcher>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.COMMUNITY);
};

export const navigateToSearchTab = <T extends NavigationDispatcher>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.SEARCH);
};

export const navigateToUserAnalyticsTab = <T extends NavigationDispatcher>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.USER_ANALYTICS);
};
