import {DrawerNavigationProp} from '@react-navigation/drawer';
import {useNavigation} from '@react-navigation/native';

import {DrawerParamList} from '@/navigation/types';

export const useDrawerNavigation = () => {
  return useNavigation<DrawerNavigationProp<DrawerParamList>>();
};
