import {DrawerNavigationProp} from '@react-navigation/drawer';
import {useNavigation} from '@react-navigation/native';

import {DrawerParamList} from '@/navigation';

export const useDrawerNavigation = () => {
  return useNavigation<DrawerNavigationProp<DrawerParamList>>();
};
