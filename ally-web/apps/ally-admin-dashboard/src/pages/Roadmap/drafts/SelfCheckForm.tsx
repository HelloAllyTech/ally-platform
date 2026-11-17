import React, { useState } from "react";

import { TextArea } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { RoadmapDialog } from "../components/RoadmapDialog";

import type { RoadmapSelfCheck } from "../../../types/roadmapV2Flow";

const FIELDS: (keyof RoadmapSelfCheck)[] = ["who", "pain", "why", "goal", "outcome"];
export const SELF_CHECK_FIELD_MAX = 200;

interface SelfCheckFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (fields: RoadmapSelfCheck) => Promise<boolean>;
  sheet: boolean;
}

/**
 * "Fill it in yourself" (§4.13): the agent never blocks a person. Five short fields, one per
 * check; saving marks the idea self-checked so the Owner sees it in triage.
 */
export const SelfCheckForm: React.FC<SelfCheckFormProps> = ({ open, onClose, onSave, sheet }) => {
  const copy = en.roadmapV2.draft;
  const [values, setValues] = useState<RoadmapSelfCheck>({
    who: "",
    pain: "",
    why: "",
    goal: "",
    outcome: "",
  });
  const [saving, setSaving] = useState(false);
  const complete = FIELDS.every(f => values[f].trim().length > 0);

  const save = async () => {
    if (!complete || saving) return;
    setSaving(true);
    const trimmed = Object.fromEntries(
      FIELDS.map(f => [f, values[f].trim()]),
    ) as unknown as RoadmapSelfCheck;
    const ok = await onSave(trimmed);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <RoadmapDialog
      open={open}
      onClose={onClose}
      title={copy.selfCheckTitle}
      primaryText={copy.selfCheckSave}
      onPrimary={save}
      primaryDisabled={!complete || saving}
      secondaryText={copy.selfCheckCancel}
      sheet={sheet}
      closeLabel={copy.selfCheckCancel}
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-typography-secondary">{copy.selfCheckIntro}</p>
        {FIELDS.map(field => (
          <TextArea
            key={field}
            id={`roadmap-self-check-${field}`}
            labelText={copy.selfCheckFields[field]}
            rows={2}
            maxCount={SELF_CHECK_FIELD_MAX}
            enableCounter
            value={values[field]}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setValues(v => ({ ...v, [field]: event.target.value.slice(0, SELF_CHECK_FIELD_MAX) }))
            }
          />
        ))}
      </div>
    </RoadmapDialog>
  );
};
