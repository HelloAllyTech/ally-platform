import {useEffect, useState} from 'react';
import {check, openSettings, request, RESULTS} from 'react-native-permissions';

import {useErrorToast} from '@/components';
import {
  LearningPathType,
  MICROPHONE_PERMISSION,
  SCREEN_NAMES,
} from '@/constants';
import {useStartScenarioSessionMutation} from '@/services';

import {useAppNavigation} from './useAppNavigation';
import {usePermissionAlert} from './usePermissionAlert';
import {useTranslate} from './useTranslate';

interface UseStartSimulationReturn {
  isCreatingRoom: boolean;
  isMicPermissionGranted: boolean;
  activeSimulationId: string | null;
  showActiveSimulationModal: boolean;
  startSimulation: (
    scenarioId: number,
    scenarioPathSessionItemId?: string,
    pathId?: string,
    languageId?: number,
    contextType?: LearningPathType,
  ) => Promise<void>;
  closeActiveSimulationModal: () => void;
  setShowActiveSimulationModal: (show: boolean) => void;
}

/**
 * Custom hook for starting a simulation
 *
 * Handles:
 * - Microphone permission checks
 * - Creating simulation session
 * - Navigating to simulation assistant
 * - Handling active simulation conflicts
 */
export const useStartSimulation = (): UseStartSimulationReturn => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const {showErrorToast} = useErrorToast();
  const {showSettingsAlert} = usePermissionAlert();

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isMicPermissionGranted, setIsMicPermissionGranted] = useState(false);
  const [activeSimulationId, setActiveSimulationId] = useState<string | null>(
    null,
  );
  const [showActiveSimulationModal, setShowActiveSimulationModal] =
    useState(false);

  const [startScenarioSession] = useStartScenarioSessionMutation();

  useEffect(() => {
    check(MICROPHONE_PERMISSION).then(status => {
      setIsMicPermissionGranted(status === RESULTS.GRANTED);
    });
  }, []);

  const closeActiveSimulationModal = () => {
    setShowActiveSimulationModal(false);
    setActiveSimulationId(null);
  };

  const startSimulation = async (
    scenarioId: number,
    scenarioPathSessionItemId?: string,
    pathId?: string,
    languageId?: number,
    contextType: LearningPathType = LearningPathType.TRACK,
  ) => {
    try {
      if (!isMicPermissionGranted) {
        const result = await request(MICROPHONE_PERMISSION);
        if (result === RESULTS.BLOCKED) {
          showSettingsAlert(
            'Common.permissions.microphoneRequired',
            'Common.permissions.microphoneMessage',
            {
              cancelKey: 'Common.cancel',
              settingsKey: 'Common.ok',
              onCancel: undefined,
              onOpenSettings: () => openSettings(),
            },
          );
          return;
        }
        if (result !== RESULTS.GRANTED) {
          showErrorToast(
            new Error(t('Common.permissions.microphoneMessage')),
            'Errors.permission',
          );
          return;
        }
        setIsMicPermissionGranted(true);
      }

      setIsCreatingRoom(true);
      const startResp = await startScenarioSession({
        scenarioId,
        ...(scenarioPathSessionItemId && {scenarioPathSessionItemId}),
        ...(languageId && {languageId}),
      }).unwrap();

      if (startResp) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          sessionData: {
            id: startResp.scenarioSession.id,
            accessToken: startResp.accessToken.token,
            liveKitServerUrl: startResp.accessToken.serverUrl,
          },
          scenario: startResp.scenario,
          ...(scenarioPathSessionItemId && {
            pathSessionItemId: scenarioPathSessionItemId,
          }),
          ...(pathId && {pathId}),
          contextType,
        });
      }
    } catch (error) {
      const err = error as {data?: {entityId?: string}};
      if (err.data?.entityId) {
        setActiveSimulationId(err.data?.entityId || null);
        setShowActiveSimulationModal(true);
      } else {
        showErrorToast(error, 'Errors.startSimulation');
      }
    } finally {
      setIsCreatingRoom(false);
    }
  };

  return {
    isCreatingRoom,
    isMicPermissionGranted,
    activeSimulationId,
    showActiveSimulationModal,
    startSimulation,
    closeActiveSimulationModal,
    setShowActiveSimulationModal,
  };
};
