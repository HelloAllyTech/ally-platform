import React from "react";

import { useGetAllyGuideConfigLayerQuery, useSaveAllyGuideConfigMutation } from "@api";
import { AllyGuideConfigEditLayer } from "@types";

import { ConfigForm } from "./ConfigForm";
import { ErrorPanel, LoadingBlock } from "./ConsoleStates";

interface ConfigLayerEditorProps {
  layer: AllyGuideConfigEditLayer;
  /** The organisation's or the course's id. */
  scopeId: string;
  canEdit: boolean;
  /** Names the thing that failed to load: "this course's settings". */
  what: string;
}

/**
 * One layer's configuration: fetch its view, render the generated form, save through the PUT. The
 * view is re-read after a save (the slice invalidates it), and the form resets on the new version.
 * A missing grant, a missing course or a failed read each say so, and a read of the wrong thing
 * never looks like an empty form.
 */
export const ConfigLayerEditor: React.FC<ConfigLayerEditorProps> = ({
  layer,
  scopeId,
  canEdit,
  what,
}) => {
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideConfigLayerQuery({
    layer,
    scopeId,
  });
  const [save] = useSaveAllyGuideConfigMutation();

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what={what} error={error} onRetry={() => void refetch()} />;
  }
  return (
    <ConfigForm
      view={data}
      canEdit={canEdit}
      onReload={() => void refetch()}
      onSave={(change, expectedVersion) =>
        save({
          layer,
          scopeId,
          set: change.set,
          clear: change.clear,
          expectedVersion,
        }).unwrap()
      }
    />
  );
};
