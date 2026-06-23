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
        showToast(t('common.simulationEndedSuccess'), 'success');
      } else {
        showErrorToast(response.error, 'errors.endSimulation');
      }
    } catch (error) {
      showErrorToast(error, 'errors.endSimulation');
    } finally {
      setIsEndingSession(false);
    }
  };

  return (
    <IllustratedActionModal
      visible={visible}
      titleMain={t('learn.scenario.existing.titleNormal')}
      titleItalic={t('learn.scenario.existing.titleItalic')}
      description={t('learn.scenario.existing.content')}
      illustration={<RunningSimulationIcon />}
      actions={[
        {
          label: t('common.cancel'),
          onPress: onClose,
          variant: 'secondary',
        },
        {
          label: t('simulationPage.endSession'),
          onPress: handleEndSession,
          variant: 'primary',
          isLoading: isEndingSession,
        },
      ]}
    />
  );
};
