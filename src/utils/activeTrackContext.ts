import {AsyncStorageKeys} from '@/constants/asyncStorage';
import type {ActiveTrackContext} from '@/types';

import {getItem, removeItem, setItem} from './asyncStorage';

export const setActiveTrackContext = (context: ActiveTrackContext) =>
  setItem(AsyncStorageKeys.ACTIVE_TRACK_CONTEXT, context);

export const getActiveTrackContext = () =>
  getItem<ActiveTrackContext>(AsyncStorageKeys.ACTIVE_TRACK_CONTEXT);

export const clearActiveTrackContext = () =>
  removeItem(AsyncStorageKeys.ACTIVE_TRACK_CONTEXT);
