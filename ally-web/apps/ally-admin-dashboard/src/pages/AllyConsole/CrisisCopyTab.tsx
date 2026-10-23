import React from "react";

import {
  useDeleteAllyGuideCrisisResponseMutation,
  useGetAllyGuideCrisisResponsesQuery,
  useSaveAllyGuideCrisisResponseMutation,
} from "@api";
import { ErrorPanel, LoadingBlock, ViewOnlyNote } from "@components/ally-guide/ConsoleStates";
import { CrisisCopyEditor } from "@components/ally-guide/CrisisCopyEditor";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";

/**
 * The platform's fixed crisis message, one text area per language, each with its version and
 * approver. No model writes this text. Saving asks for a clinician's sign-off, creates a new
 * version, and keeps the previous one; withdrawing falls learners back to English and then to the
 * built-in default. An organisation can override it for its own learners on its Ally tab.
 */
export const CrisisCopyTab: React.FC = () => {
  const strings = en.allyConsole.crisisCopy;
  const { canEdit } = useAllyGuideAccess();
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideCrisisResponsesQuery();
  const [save] = useSaveAllyGuideCrisisResponseMutation();
  const [withdraw] = useDeleteAllyGuideCrisisResponseMutation();

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what="the crisis copy" error={error} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="ally-crisis-copy">
      <p className="text-sm text-typography-800">{strings.intro}</p>
      {!canEdit && <ViewOnlyNote />}
      <CrisisCopyEditor
        rows={data}
        canEdit={canEdit}
        onSave={(languageCode, body) => save({ languageCode, body }).unwrap()}
        onWithdraw={async row => {
          await withdraw(row.id).unwrap();
        }}
      />
    </div>
  );
};
