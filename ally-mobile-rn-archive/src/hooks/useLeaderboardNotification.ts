import {useEffect, useState} from 'react';

import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {
  cancelWeeklyLeaderboardNotification,
  scheduleWeeklyLeaderboardNotification,
} from '@/services/notificationService';
import {getItem, setItem} from '@/utils/asyncStorage';

interface UseLeaderboardNotificationOptions {
  isLearner: boolean;
}

interface UseLeaderboardNotificationReturn {
  leaderboardNotifEnabled: boolean;
  handleLeaderboardNotifToggle: (value: boolean) => Promise<void>;
}

export const useLeaderboardNotification = ({
  isLearner,
}: UseLeaderboardNotificationOptions): UseLeaderboardNotificationReturn => {
  const [leaderboardNotifEnabled, setLeaderboardNotifEnabled] = useState(true);

  useEffect(() => {
    if (!isLearner) return;
    getItem<boolean>(AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED).then(
      stored => {
        // null means never set — default is ON
        setLeaderboardNotifEnabled(stored === null ? true : stored);
      },
    );
  }, [isLearner]);

  const handleLeaderboardNotifToggle = async (value: boolean) => {
    setLeaderboardNotifEnabled(value);
    await setItem(AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED, value);
    if (value) {
      await scheduleWeeklyLeaderboardNotification();
    } else {
      await cancelWeeklyLeaderboardNotification();
    }
  };

  return {leaderboardNotifEnabled, handleLeaderboardNotifToggle};
};
