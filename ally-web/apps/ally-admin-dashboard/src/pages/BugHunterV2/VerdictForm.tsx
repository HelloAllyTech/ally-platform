import { FC, useState } from "react";

import { toast } from "sonner";

import { Button, RadioButton, RadioButtonGroup, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { useRecordBugHunterV2VerdictMutation } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { BugHunterV2Diagnosis, BugHunterV2FixVerdict, BugHunterV2Verdict } from "@types";

interface VerdictFormProps {
  reportId: number;
  hasPatch: boolean;
  current: BugHunterV2Verdict | null;
}

const DIAGNOSES: BugHunterV2Diagnosis[] = ["correct", "wrong", "not_a_bug"];
const FIXES: BugHunterV2FixVerdict[] = ["worked", "needed_edits", "wrong", "none"];

const Help: FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button
      type="button"
      className="ml-1 inline-flex cursor-pointer items-center"
      aria-label={label}
    >
      <TooltipIcon />
    </button>
  </Tooltip>
);

/**
 * The two-part verdict: was the diagnosis right, did the fix work, and why. A new
 * verdict replaces the current one (kept in the history); Bug Hunter's feedback job
 * retracts what the old one taught. With no patch, the fix can only be "none".
 */
export const VerdictForm: FC<VerdictFormProps> = ({ reportId, hasPatch, current }) => {
  const strings = en.bugHunterV2.verdict;
  const [diagnosis, setDiagnosis] = useState<BugHunterV2Diagnosis | "">(current?.diagnosis ?? "");
  const [fix, setFix] = useState<BugHunterV2FixVerdict | "">(
    current?.fix ?? (hasPatch ? "" : "none"),
  );
  const [reason, setReason] = useState("");
  const [showReasonError, setShowReasonError] = useState(false);
  const [record, { isLoading }] = useRecordBugHunterV2VerdictMutation();

  const fixAllowed = (f: BugHunterV2FixVerdict) =>
    (hasPatch || f === "none") &&
    !(diagnosis === "not_a_bug" && (f === "worked" || f === "needed_edits"));

  const submit = async () => {
    if (!reason.trim()) {
      setShowReasonError(true);
      return;
    }
    if (!diagnosis || !fix) return;
    try {
      await record({ id: reportId, diagnosis, fix, reason: reason.trim() }).unwrap();
      toast.success(strings.saved);
      setReason("");
      setShowReasonError(false);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      toast.error(status === 409 ? strings.conflict : strings.saveError);
    }
  };

  return (
    <section
      className="flex flex-col gap-4 rounded border border-neutral-200 p-4"
      aria-label={strings.title}
    >
      <h2 className="text-base font-semibold text-typography-900">
        {current ? strings.amendTitle : strings.title}
      </h2>
      <RadioButtonGroup
        legendText={
          <span className="inline-flex items-center">
            {strings.diagnosis}
            <Help label={strings.diagnosisHelp} />
          </span>
        }
        name={`diagnosis-${reportId}`}
        valueSelected={diagnosis}
        onChange={(value: unknown) => setDiagnosis(value as BugHunterV2Diagnosis)}
      >
        {DIAGNOSES.map(d => (
          <RadioButton key={d} id={`diagnosis-${d}`} value={d} labelText={strings.diagnoses[d]} />
        ))}
      </RadioButtonGroup>
      <RadioButtonGroup
        legendText={
          <span className="inline-flex items-center">
            {strings.fix}
            <Help label={strings.fixHelp} />
          </span>
        }
        name={`fix-${reportId}`}
        valueSelected={fix}
        onChange={(value: unknown) => setFix(value as BugHunterV2FixVerdict)}
      >
        {FIXES.map(f => (
          <RadioButton
            key={f}
            id={`fix-${f}`}
            value={f}
            labelText={strings.fixes[f]}
            disabled={!fixAllowed(f)}
          />
        ))}
      </RadioButtonGroup>
      <TextArea
        id={`reason-${reportId}`}
        labelText={strings.reason}
        placeholder={strings.reasonPlaceholder}
        value={reason}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          setReason(e.target.value);
          if (e.target.value.trim()) setShowReasonError(false);
        }}
        invalid={showReasonError}
        invalidText={strings.reasonRequired}
        maxCount={2000}
        rows={3}
      />
      <div>
        <Button
          kind="primary"
          onClick={submit}
          disabled={isLoading || !diagnosis || !fix || !fixAllowed(fix as BugHunterV2FixVerdict)}
        >
          {current ? strings.amend : strings.submit}
        </Button>
      </div>
    </section>
  );
};
