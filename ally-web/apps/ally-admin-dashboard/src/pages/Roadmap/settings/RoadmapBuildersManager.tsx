import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  FilterableMultiSelect,
  InlineNotification,
  Modal,
  SkeletonText,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { useListRoadmapRolesQuery, useSetRoadmapRoleForMutation } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapRoleEntry } from "@types";

interface Option {
  id: number;
  label: string;
}

const same = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

const join = (names: string[]) => names.join(", ");

/**
 * Roadmap → Settings → Builders: which Ally admins can be picked as the builder of an idea.
 *
 * It is the Users screen's "Roadmap role" radio, set for many people at once and in one place.
 * Choosing someone gives them the Builder role (the Roadmap, Builder and nothing else); taking
 * them off sets them back to Idea, never to None, so they keep seeing and voting on the board.
 * Owners are not listed: they can always build, and one can't be demoted from here.
 *
 * Saving asks first, because a builder approves designs, starts builds and merges pull requests.
 *
 * A person can be chosen and still not be able to build: the role reads the toggle AND the
 * Builder permission, behind a 30-minute cache. That is shown under the list rather than left to
 * look like the setting did nothing (OPP-0938: two admins sat at Builder with no permission, and
 * the picker silently left them out).
 */
export const RoadmapBuildersManager: React.FC = () => {
  const copy = en.roadmapV2Tools.settings.builders;
  const { data, isLoading, isError } = useListRoadmapRolesQuery();
  const [setRole] = useSetRoadmapRoleForMutation();

  const users: RoadmapRoleEntry[] = data?.users ?? [];
  const owners = users.filter(user => user.setting === "owner");
  const restricted = users.filter(user => user.restricted && user.setting !== "owner");
  const candidates = users.filter(user => !user.restricted && user.setting !== "owner");

  // Two people can share a name (an admin and their other account), so the id disambiguates.
  const options: Option[] = useMemo(() => {
    const count = new Map<string, number>();
    candidates.forEach(user => count.set(user.name, (count.get(user.name) ?? 0) + 1));
    return candidates.map(user => ({
      id: user.userId,
      label: (count.get(user.name) ?? 0) > 1 ? `${user.name} (#${user.userId})` : user.name,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saved = candidates.filter(user => user.setting === "builder").map(user => user.userId);
  const [picked, setPicked] = useState<number[]>(saved);
  const savedKey = [...saved].sort().join();
  // A fresh answer from the server (after a save, or another Owner's change) is the new baseline.
  useEffect(() => setPicked(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameOf = (id: number) => candidates.find(user => user.userId === id)?.name ?? `User ${id}`;
  const added = picked.filter(id => !saved.includes(id));
  const removed = saved.filter(id => !picked.includes(id));
  const dirty = !same(picked, saved);

  // Chosen and saved, yet their effective role isn't Builder yet.
  const notYet = candidates.filter(user => user.setting === "builder" && user.role !== "builder");

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    const failed: string[] = [];
    const changes: { id: number; role: "builder" | "idea" }[] = [
      ...added.map(id => ({ id, role: "builder" as const })),
      ...removed.map(id => ({ id, role: "idea" as const })),
    ];
    for (const change of changes) {
      try {
        await setRole({ userId: change.id, role: change.role }).unwrap();
      } catch {
        failed.push(nameOf(change.id));
      }
    }
    setSaving(false);
    if (!failed.length) toast.success(copy.saved);
    else if (failed.length === changes.length) toast.error(copy.failed);
    else toast.warning(copy.savedPartly(join(failed)));
  };

  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  if (isError) {
    return <InlineNotification kind="error" lowContrast hideCloseButton title={copy.loadFailed} />;
  }
  if (!options.length) return <p className="m-0 text-sm text-typography-600">{copy.empty}</p>;

  const selected = options.filter(option => picked.includes(option.id));

  return (
    <div className="flex flex-col gap-3" data-testid="roadmap-builders-manager">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-typography-900">{copy.label}</span>
        <Tooltip label={copy.hint} align="top">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>

      <FilterableMultiSelect
        id="roadmap-builders"
        titleText=""
        placeholder={copy.placeholder}
        items={options}
        itemToString={(item: Option | null) => item?.label ?? ""}
        initialSelectedItems={selected}
        selectedItems={selected}
        disabled={saving}
        onChange={({ selectedItems }: { selectedItems: Option[] | null }) =>
          setPicked((selectedItems ?? []).map(item => item.id))
        }
      />

      {owners.length > 0 && (
        <p className="m-0 text-xs text-typography-600">
          {copy.owners(join(owners.map(user => user.name)))}
        </p>
      )}
      {restricted.length > 0 && (
        <p className="m-0 text-xs text-typography-600">{copy.restricted(restricted.length)}</p>
      )}

      {notYet.length > 0 && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={copy.notYet(join(notYet.map(user => user.name)))}
        />
      )}

      <div className="flex items-center gap-3">
        <Button
          kind="primary"
          size="md"
          disabled={!dirty || saving}
          onClick={() => setConfirming(true)}
        >
          {saving ? copy.saving : copy.save}
        </Button>
        {dirty && !saving && <span className="text-sm text-typography-600">{copy.unsaved}</span>}
      </div>

      <Modal
        open={confirming}
        size="sm"
        modalHeading={copy.confirmTitle}
        primaryButtonText={copy.confirmButton}
        secondaryButtonText={copy.cancel}
        onRequestClose={() => setConfirming(false)}
        onRequestSubmit={() => void save()}
      >
        <div className="flex flex-col gap-2 text-sm text-typography-800">
          {added.length > 0 && <p className="m-0">{copy.confirmAdd(join(added.map(nameOf)))}</p>}
          {removed.length > 0 && (
            <p className="m-0">{copy.confirmRemove(join(removed.map(nameOf)))}</p>
          )}
        </div>
      </Modal>
    </div>
  );
};
