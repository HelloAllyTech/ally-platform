import { FC, useState } from "react";

import { toast } from "sonner";

import { useGetTenantsQuery } from "@api";
import { Button, ConfirmDialog } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants/en";

export interface BulkAccessConfig {
  /** Plural noun for copy: "simulations", "courses"... */
  noun: string;
  /** Ids of published items that are (assigned=true) or are not (false) enabled for a tenant. */
  fetchIds: (tenantId: string, assigned: boolean) => Promise<(string | number)[]>;
  /** Enable the given ids for this organisation. Throws on failure. */
  enable: (ids: (string | number)[]) => Promise<void>;
}

type Pending =
  | { kind: "all"; ids: (string | number)[] }
  | { kind: "copy"; ids: (string | number)[]; fromName: string };

/**
 * "Enable all" and "Copy from another organisation" for a content-access tab. Both only ever
 * turn access ON (nothing is switched off), so they are reversible one item at a time and the
 * confirmation states exactly how many items change.
 */
export const BulkAccessBar: FC<{
  tenantId: string;
  config: BulkAccessConfig;
  onDone: () => void;
}> = ({ tenantId, config, onDone }) => {
  const t = en.organizationAccess.bulk;
  const [fromId, setFromId] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const { data: tenantsPage } = useGetTenantsQuery({ limit: 1000 });
  const others = (tenantsPage?.data ?? []).filter(o => o.id !== tenantId);

  const prepare = async (kind: "all" | "copy") => {
    setBusy(true);
    try {
      const wanted =
        kind === "all"
          ? await config.fetchIds(tenantId, false)
          : await config.fetchIds(fromId, true);
      let ids = wanted;
      if (kind === "copy") {
        const already = new Set(await config.fetchIds(tenantId, true));
        ids = wanted.filter(id => !already.has(id));
      }
      if (ids.length === 0) {
        toast.info(t.nothingToChange(config.noun));
        return;
      }
      setPending(
        kind === "all"
          ? { kind, ids }
          : { kind, ids, fromName: others.find(o => o.id === fromId)?.name ?? "" },
      );
    } catch {
      toast.error(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await config.enable(pending.ids);
      toast.success(t.done(pending.ids.length, config.noun));
      setPending(null);
      onDone();
    } catch {
      toast.error(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="bulk-access-bar">
      <Button
        variant={ButtonVariant.SECONDARY}
        disabled={busy}
        onClick={() => void prepare("all")}
        title={t.enableAllHint(config.noun)}
      >
        {t.enableAll}
      </Button>
      <label className="sr-only" htmlFor="bulk-access-source">
        {t.copyFrom}
      </label>
      <select
        id="bulk-access-source"
        className="h-10 rounded border border-border-light bg-white px-2 text-sm"
        value={fromId}
        onChange={e => setFromId(e.target.value)}
      >
        <option value="">{t.copyFrom}</option>
        {others.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <Button
        variant={ButtonVariant.SECONDARY}
        disabled={busy || !fromId}
        onClick={() => void prepare("copy")}
      >
        {t.copy}
      </Button>
      <ConfirmDialog
        isOpen={!!pending}
        title={pending?.kind === "copy" ? t.copyTitle(pending.fromName) : t.enableAllTitle}
        consequence={pending ? t.consequence(pending.ids.length, config.noun) : ""}
        confirmLabel={t.confirm(pending?.ids.length ?? 0)}
        isLoading={busy}
        onConfirm={() => void run()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};
