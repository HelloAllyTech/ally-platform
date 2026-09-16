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

export const navigateToTab = <T extends NavigationProp<RootStackParamList>>(
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

export const navigateToLearnTab = <
  T extends NavigationProp<RootStackParamList>,
>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.LEARN);
};

export const navigateToCallLogTab = <
  T extends NavigationProp<RootStackParamList>,
>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.CALL_LOG);
};

export const navigateToCommunityTab = <
  T extends NavigationProp<RootStackParamList>,
>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.COMMUNITY);
};

export const navigateToSearchTab = <
  T extends NavigationProp<RootStackParamList>,
>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.SEARCH);
};

export const navigateToUserAnalyticsTab = <
  T extends NavigationProp<RootStackParamList>,
>(
  navigation: T,
) => {
  navigateToTab(navigation, SCREEN_NAMES.USER_ANALYTICS);
};
