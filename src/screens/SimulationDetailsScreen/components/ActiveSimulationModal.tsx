import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';

import {RunningSimulationIcon} from '@/assets/icons';
import {IllustratedActionModal, useErrorToast, useToast} from '@/components';
import {useEndScenarioSessionMutation} from '@/services';

interface ActiveSimulationModalProps {
  visible: boolean;
  onClose: () => void;
  scenarioSessionId: string;
}

export const ActiveSimulationModal: React.FC<ActiveSimulationModalProps> = ({
  visible,
  onClose,
  scenarioSessionId,
}) => {
  const {t} = useTranslation();
  const {showErrorToast} = useErrorToast();
  const {showToast} = useToast();
  const [endScenarioSession] = useEndScenarioSessionMutation();
  const [isEndingSession, setIsEndingSession] = useState(false);

  const handleEndSession = async () => {
    try {
      setIsEndingSession(true);
      const response = await endScenarioSession({
        scenarioSessionId: scenarioSessionId,
      });
      onClose();
      if (!response.error) {
        showToast(t('Simulations.sessionEndedSuccessfully'), 'success');
      } else {
        showErrorToast(response.error, 'Errors.endSimulation');
      }
    } catch (error) {
      showErrorToast(error, 'Errors.endSimulation');
    } finally {
      setIsEndingSession(false);
    }
  };

  return (
    <IllustratedActionModal
      visible={visible}
      titleMain={t('Simulations.activeSimulation')}
      titleItalic={t('Simulations.detected')}
      description={t('Simulations.activeSimulationDescription')}
      illustration={<RunningSimulationIcon />}
      actions={[
        {
          label: t('Common.cancel'),
          onPress: onClose,
          variant: 'secondary',
        },
        {
          label: t('SimulationAssistant.endSession'),
          onPress: handleEndSession,
          variant: 'primary',
          isLoading: isEndingSession,
        },
      ]}
    />
  );
};
