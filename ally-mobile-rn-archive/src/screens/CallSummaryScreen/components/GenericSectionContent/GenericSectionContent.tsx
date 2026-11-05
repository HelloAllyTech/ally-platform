import React, {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {SummaryFieldKey} from '@/constants/summary';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {
  selectCallDetails,
  selectCallInfo,
  selectFormData,
  selectSummary,
  setFormData,
} from '@/store/slices/summarySlice';
import {FieldDataContext, SummaryField} from '@/types';
import {
  formatFieldValue,
  getFieldValue,
  renderField,
} from '@/utils/fieldRenderer';

interface GenericSectionContentProps {
  fields: SummaryField[];
  isEditing: boolean;
  isEnhancing: boolean;
}

export const GenericSectionContent: React.FC<GenericSectionContentProps> = ({
  fields,
  isEditing,
  isEnhancing,
}) => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();

  const summary = useAppSelector(selectSummary);
  const formData = useAppSelector(selectFormData);
  const callDetails = useAppSelector(selectCallDetails);
  const callInfo = useAppSelector(selectCallInfo);

  const [openDropdown, setOpenDropdown] = useState<SummaryFieldKey | null>(
    null,
  );

  const dataContext: FieldDataContext = useMemo(
    () => ({
      summary: summary ?? null,
      formData,
      callDetails,
      callInfo,
    }),
    [summary, formData, callDetails, callInfo],
  );

  const handleFieldChange = useCallback(
    (fieldKey: SummaryFieldKey) => (value: string) => {
      dispatch(setFormData({...formData, [fieldKey]: value}));
    },
    [dispatch, formData],
  );

  const handleDropdownToggle = useCallback(
    (fieldKey: SummaryFieldKey, open: boolean) => {
      setOpenDropdown(open ? fieldKey : null);
    },
    [],
  );

  const handleDropdownSelect = useCallback(
    (fieldKey: SummaryFieldKey) => (value: string) => {
      dispatch(setFormData({...formData, [fieldKey]: value}));
      setOpenDropdown(null);
    },
    [dispatch, formData],
  );

  return (
    <>
      {fields.map(field => {
        const value = getFieldValue(field, dataContext);
        const displayValue = formatFieldValue(field, value, t);

        return renderField(
          field,
          value,
          displayValue,
          isEditing,
          isEnhancing,
          handleFieldChange(field.key),
          {
            openDropdown,
            onDropdownToggle: handleDropdownToggle,
            onDropdownSelect: handleDropdownSelect,
            t,
            canEdit: true,
          },
        );
      })}
    </>
  );
};
