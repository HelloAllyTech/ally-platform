// Deliberately free of `@utils`: that barrel pulls in the constants graph, which breaks under
// circular imports when this file is loaded on its own (as a unit test does).
const isNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === "";

/** Whether one mandatory form value counts as filled. */
export const isMandatoryValueFilled = (value: unknown): boolean => {
  if (isEmpty(value)) return false;
  // A non-empty array satisfies a mandatory array field.
  if (Array.isArray(value)) return isNonEmptyArray(value);
  if (typeof FileList !== "undefined" && value instanceof FileList && value.length === 0) {
    return false;
  }
  return true;
};

/** A case can be saved or published once its mandatory fields are filled and it has at least one simulation. */
export const areCaseFieldsFilled = (
  mandatoryFieldIds: string[],
  formValues: Record<string, unknown> | undefined,
): boolean =>
  mandatoryFieldIds.every(fieldId => isMandatoryValueFilled(formValues?.[fieldId])) &&
  isNonEmptyArray(formValues?.scenarios);
