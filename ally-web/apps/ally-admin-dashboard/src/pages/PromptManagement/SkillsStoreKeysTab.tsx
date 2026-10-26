import React, { useState } from "react";

import { toast } from "sonner";

import {
  useCreateSkillsStoreKeyMutation,
  useGetSkillsStoreKeysQuery,
  useRevokeSkillsStoreKeyMutation,
} from "@api";
import { Copy } from "@assets";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { IssuedSkillsStoreKey, SkillsStoreKey, SkillsStoreKeyScope } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

const FIELD =
  "w-full h-10 rounded-none border-0 border-b border-border-dark bg-secondary-50 px-3 text-base text-neutral-800 placeholder:text-typography-placeholder focus:outline-none focus:border-b-2 focus:border-primary-500 transition-colors";

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

/**
 * Keys for the `prompts` CLI. Anyone with Skills Store access generates one
 * here, shares it (contractors included) and revokes it when it is no longer
 * needed. A key is shown once, at creation; the list only ever shows its first
 * characters so it can be recognised.
 */
export const SkillsStoreKeysTab: React.FC = () => {
  const strings = en.skillsStore.keys;
  const { data: keys, isLoading } = useGetSkillsStoreKeysQuery();
  const [createKey, { isLoading: isCreating }] = useCreateSkillsStoreKeyMutation();
  const [revokeKey] = useRevokeSkillsStoreKeyMutation();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<SkillsStoreKeyScope>>(new Set(["pull"]));
  const [issued, setIssued] = useState<IssuedSkillsStoreKey | null>(null);
  const [revoking, setRevoking] = useState<SkillsStoreKey | null>(null);

  const toggleScope = (scope: SkillsStoreKeyScope, on: boolean) =>
    setScopes(previous => {
      const next = new Set(previous);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  const handleCreate = async () => {
    if (!name.trim() || scopes.size === 0) return;
    try {
      const result = await createKey({ name: name.trim(), scopes: [...scopes] }).unwrap();
      setIssued(result);
      setName("");
      setScopes(new Set(["pull"]));
    } catch (error) {
      toast.error(getErrorMessage(error, strings.createFailed));
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      toast.success(strings.copied);
    } catch {
      // Clipboard unavailable: the key is still on screen to select by hand.
    }
  };

  const handleRevoke = async () => {
    const target = revoking;
    setRevoking(null);
    if (!target) return;
    try {
      await revokeKey(target.id).unwrap();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.revokeFailed));
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl" data-testid="skills-store-keys">
      <p className="text-sm text-typography-700">{strings.intro}</p>

      {issued ? (
        <div
          role="status"
          className="border-l-4 border-primary-500 bg-primary-50 p-4 flex flex-col gap-3"
          data-testid="skills-store-new-key"
        >
          <p className="text-base font-medium text-typography-900">{strings.newKeyTitle}</p>
          <p className="text-sm text-typography-700">{strings.newKeyBody}</p>
          <code className="select-all break-all bg-white px-3 py-2 font-mono text-sm text-neutral-800 border border-border-light">
            {issued.key}
          </code>
          <div className="flex items-center gap-3">
            <Button variant={ButtonVariant.SECONDARY} onClick={() => void handleCopy()}>
              <Copy width={16} height={16} />
              {strings.copy}
            </Button>
            <Button variant={ButtonVariant.PRIMARY} onClick={() => setIssued(null)}>
              {strings.done}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border border-border-light p-4">
          <label className="text-xs tracking-[0.32px] text-neutral-600" htmlFor="ssk-name">
            {strings.name}
          </label>
          <input
            id="ssk-name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={strings.namePlaceholder}
            className={FIELD}
            maxLength={120}
          />
          <span className="text-xs tracking-[0.32px] text-neutral-600">{strings.scopes}</span>
          <label className="flex items-center gap-2 text-base text-typography-900 cursor-pointer">
            <input
              type="checkbox"
              checked={scopes.has("pull")}
              onChange={event => toggleScope("pull", event.target.checked)}
            />
            {strings.scopePull}
          </label>
          <label className="flex items-center gap-2 text-base text-typography-900 cursor-pointer">
            <input
              type="checkbox"
              checked={scopes.has("push")}
              onChange={event => toggleScope("push", event.target.checked)}
            />
            {strings.scopePush}
          </label>
          <div>
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={() => void handleCreate()}
              disabled={!name.trim() || scopes.size === 0 || isCreating}
            >
              {isCreating ? strings.creating : strings.create}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col divide-y divide-border-light border-y border-border-light">
        {isLoading && <span className="py-3 text-sm text-typography-500">{en.common.loading}</span>}
        {!isLoading && !keys?.length && (
          <span className="py-3 text-sm text-typography-500">{strings.none}</span>
        )}
        {keys?.map(key => (
          <div
            key={key.id}
            className="flex items-center justify-between gap-3 py-3"
            data-testid={`skills-store-key-${key.id}`}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-typography-900 break-words">
                  {key.name}
                </span>
                <span
                  className={
                    "inline-flex px-2 py-0.5 rounded text-xs " +
                    (key.revokedAt
                      ? "bg-neutral-100 text-neutral-700"
                      : "bg-green-100 text-green-800")
                  }
                >
                  {key.revokedAt ? strings.revoked : strings.active}
                </span>
              </div>
              <span className="text-xs text-typography-500">
                {[
                  `${strings.prefix} ${key.prefix}…`,
                  key.scopes.join(" + "),
                  `${strings.created} ${formatDate(key.createdAt)}`,
                  `${strings.lastUsed} ${key.lastUsedAt ? formatDate(key.lastUsedAt) : strings.never}`,
                ].join(" · ")}
              </span>
            </div>
            {!key.revokedAt && (
              <Button variant={ButtonVariant.SECONDARY} onClick={() => setRevoking(key)}>
                {strings.revoke}
              </Button>
            )}
          </div>
        ))}
      </div>

      <ActionConfirmationPopup
        isOpen={revoking != null}
        onClose={() => setRevoking(null)}
        title={revoking ? strings.revokeTitle(revoking.name) : ""}
        description={strings.revokeBody}
        primaryButton={{ label: strings.revoke, onClick: () => void handleRevoke() }}
        secondaryButton={{
          label: en.skillsStore.versions.cancel,
          onClick: () => setRevoking(null),
        }}
      />
    </div>
  );
};
