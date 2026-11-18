import { CustomFieldType } from "@types";
import { CustomFieldDefinition } from "@types";

import { formatCustomFieldDate } from "./customFieldDate";
import { optionLabel, resolveOptionIds } from "./selectValues";

export interface CustomFieldCellValue {
  fieldDefinitionId: string;
  value: string | null;
}

export const renderCustomFieldCell = (
  def: CustomFieldDefinition,
  fieldValues: CustomFieldCellValue[],
): React.ReactNode => {
  const fieldValue = fieldValues.find(v => v.fieldDefinitionId === def.id);
  if (!fieldValue?.value) return <span className="text-typography-400">—</span>;

  switch (def.fieldType) {
    case CustomFieldType.DATE: {
      // Rendered from the stored calendar date, not `new Date(value)` — a
      // date-only string parses as UTC midnight and shows the previous day in
      // any timezone behind UTC.
      const display = formatCustomFieldDate(fieldValue.value);
      return display ? <span>{display}</span> : <span className="text-typography-400">—</span>;
    }
    case CustomFieldType.BOOLEAN:
      return <span>{fieldValue.value === "true" ? "Yes" : "No"}</span>;
    case CustomFieldType.MULTI_SELECT: {
      const labels = resolveOptionIds(def, fieldValue.value)
        .map(id => optionLabel(def, id))
        .join(", ");
      return <span>{labels || "—"}</span>;
    }
    case CustomFieldType.SINGLE_SELECT: {
      const label = optionLabel(def, fieldValue.value);
      return <span>{label ?? "—"}</span>;
    }
    default:
      return <span>{fieldValue.value}</span>;
  }
};
