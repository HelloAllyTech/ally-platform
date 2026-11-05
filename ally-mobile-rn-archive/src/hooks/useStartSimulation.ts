import {useCallback, useEffect, useRef, useState} from 'react';
import {check, openSettings, request, RESULTS} from 'react-native-permissions';

import {useErrorToast} from '@/components';
import {MICROPHONE_PERMISSION, SCREEN_NAMES} from '@/constants';
import {useStartScenarioSessionMutation} from '@/services';

import {useAppNavigation} from './useAppNavigation';
import {usePermissionAlert} from './usePermissionAlert';
import {useTranslate} from './useTranslate';

interface StartSimulationParams {
  scenarioId: number;
  scenarioPathSessionItemId?: string;
  caseSessionItemId?: string;
  /** Links this session to a Track 2.0 roleplay item's progress row. */
  trackItemProgressId?: string;
  pathId?: string;
  caseId?: string;
  languageId?: number;
}

const HTTP_TOO_MANY_REQUESTS = 429;

interface UseStartSimulationReturn {
  isCreatingRoom: boolean;
  isMicPermissionGranted: boolean;
  activeSimulationId: string | null;
  showActiveSimulationModal: boolean;
  showRetryModal: boolean;
  startSimulation: (params: StartSimulationParams) => Promise<void>;
  retryStartSimulation: () => Promise<boolean>;
  closeActiveSimulationModal: () => void;
  closeRetryModal: () => void;
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
  const [showRetryModal, setShowRetryModal] = useState(false);

  const retryParamsRef = useRef<StartSimulationParams | null>(null);

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

  const closeRetryModal = useCallback(() => {
    setShowRetryModal(false);
    retryParamsRef.current = null;
  }, []);

  const callSessionStart = useCallback(
    async (params: StartSimulationParams) => {
      const startResp = await startScenarioSession({
        scenarioId: params.scenarioId,
        ...(params.scenarioPathSessionItemId && {
          scenarioPathSessionItemId: params.scenarioPathSessionItemId,
        }),
        ...(params.caseSessionItemId && {
          caseSessionItemId: params.caseSessionItemId,
        }),
        ...(params.trackItemProgressId && {
          trackItemProgressId: params.trackItemProgressId,
        }),
        ...(params.languageId && {languageId: params.languageId}),
      }).unwrap();

      if (startResp) {
        navigation.navigate(SCREEN_NAMES.SIMULATION_ASSISTANT, {
          sessionData: {
            id: startResp.scenarioSession.id,
            accessToken: startResp.accessToken.token,
            liveKitServerUrl: startResp.accessToken.serverUrl,
          },
          // Reminders are also gated server-side, but check remindersEnabled
          // here too so the client never displays them when the switch is off.
          scenario: {
            ...startResp.scenario,
            reminders: startResp.scenario?.remindersEnabled
              ? (startResp.scenario?.reminders ?? [])
              : [],
          },
          ...(params.scenarioPathSessionItemId && {
            pathSessionItemId: params.scenarioPathSessionItemId,
          }),
          ...(params.pathId && {pathId: params.pathId}),
          ...(params.caseId && {caseId: params.caseId}),
          ...(params.languageId && {languageId: params.languageId}),
        });
      }
    },
    [navigation, startScenarioSession],
  );

  const isRateLimitError = (error: unknown): boolean => {
    const err = error as {status?: number};
    return err?.status === HTTP_TOO_MANY_REQUESTS;
  };

  const startSimulation = async (
    params: StartSimulationParams,
  ): Promise<void> => {
    try {
      if (!isMicPermissionGranted) {
        const result = await request(MICROPHONE_PERMISSION);
        if (result === RESULTS.BLOCKED) {
          showSettingsAlert(
            'simulationPage.allowMicrophone',
            'simulationPage.microphonePrompt',
            {
              cancelKey: 'common.cancel',
              settingsKey: 'common.ok',
              onCancel: undefined,
              onOpenSettings: () => openSettings(),
            },
          );
          return;
        }
        if (result !== RESULTS.GRANTED) {
          showErrorToast(
            new Error(t('simulationPage.microphonePrompt')),
            'errors.permission',
          );
          return;
        }
        setIsMicPermissionGranted(true);
      }

      setIsCreatingRoom(true);
      await callSessionStart(params);
    } catch (error) {
      if (isRateLimitError(error)) {
        retryParamsRef.current = params;
        setShowRetryModal(true);
      } else {
        const err = error as {data?: {entityId?: string}};
        if (err.data?.entityId) {
          setActiveSimulationId(err.data?.entityId || null);
          setShowActiveSimulationModal(true);
        } else {
          showErrorToast(error, 'errors.startSimulation');
        }
      }
    } finally {
      setIsCreatingRoom(false);
    }
  };

  /**
   * Retry the session start with the previously stored params.
   * Returns true on success, false if still rate-limited.
   */
  const retryStartSimulation = useCallback(async (): Promise<boolean> => {
    const params = retryParamsRef.current;
    if (!params) {
      return false;
    }

    try {
      await callSessionStart(params);
      setShowRetryModal(false);
      retryParamsRef.current = null;
      return true;
    } catch (error) {
      if (isRateLimitError(error)) {
        return false;
      }
      const err = error as {data?: {entityId?: string}};
      if (err.data?.entityId) {
        setShowRetryModal(false);
        retryParamsRef.current = null;
        setActiveSimulationId(err.data?.entityId || null);
        setShowActiveSimulationModal(true);
      } else {
        setShowRetryModal(false);
        retryParamsRef.current = null;
        showErrorToast(error, 'errors.startSimulation');
      }
      return false;
    }
  }, [callSessionStart, showErrorToast]);

  return {
    isCreatingRoom,
    isMicPermissionGranted,
    activeSimulationId,
    showActiveSimulationModal,
    showRetryModal,
    startSimulation,
    retryStartSimulation,
    closeActiveSimulationModal,
    closeRetryModal,
    setShowActiveSimulationModal,
  };
};
