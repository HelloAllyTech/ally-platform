import React, { useState } from "react";

import { toast } from "sonner";

import { useListCustomLoginsQuery, useRemoveCustomLoginMutation } from "@api";
import type { CustomLogin } from "@api";
import { ActionConfirmationPopup, EmptyState, ListToolbar, StatusBadge } from "@components";
// From its own module: User Management's tests mock the `@components` barrel.
import { Button as CreateButton } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";

import { CustomLoginDetail } from "./CustomLoginDetail";
import { CustomLoginPanel } from "./CustomLoginPanel";

const t = () => en.customLogins;

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "—";

/**
 * Users → Custom logins (CR1 Part B): everyone with the Assistant owner role. Create one here;
 * open one to change what they can use, and (for `manage_costs`) their Tokens and Plan. Gated on
 * Admin User Management, like Ally admins; ally-be checks the same toggle.
 */
export const CustomLogins: React.FC = () => {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListCustomLoginsQuery(search ? { search } : undefined);
  const [remove] = useRemoveCustomLoginMutation();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<CustomLogin | null>(null);
  const logins = data?.data ?? [];
  const open = logins.find(login => login.id === openId) ?? null;

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove(removing.id).unwrap();
      toast.success(t().removed);
      if (openId === removing.id) setOpenId(null);
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message || t().removeFailed);
    } finally {
      setRemoving(null);
    }
  };

  const removeDialog = removing && (
    <ActionConfirmationPopup
      isOpen
      onClose={() => setRemoving(null)}
      title={t().removeTitle}
      description={t().removeBody(removing.name || removing.email)}
      primaryButton={{
        label: t().remove,
        onClick: confirmRemove,
        variant: ButtonVariant.DESTRUCTIVE,
      }}
      secondaryButton={{ label: t().cancel, onClick: () => setRemoving(null) }}
    />
  );

  if (open) {
    return (
      <>
        <CustomLoginDetail
          login={open}
          onBack={() => setOpenId(null)}
          onRemove={() => setRemoving(open)}
        />
        {removeDialog}
      </>
    );
  }

  return (
    <div className="py-[2px] font-primary min-w-0 relative" data-testid="custom-logins">
      <p className="text-sm text-typography-600 pb-4">{t().listIntro}</p>
      <ListToolbar searchValue={search} onSearchChange={setSearch} placeholder={t().search} />
      <div className="mt-3 flex justify-end">
        <CreateButton
          variant={ButtonVariant.PRIMARY}
          onClick={() => setCreating(true)}
          data-testid="custom-login-create"
        >
          {t().create}
        </CreateButton>
      </div>
      <div className="mt-[20px] md:overflow-y-auto md:h-[calc(100vh-260px)]">
        {isLoading ? (
          <div className="flex justify-center py-16 text-typography-600">{t().loadingList}</div>
        ) : logins.length === 0 ? (
          <EmptyState title={t().empty} subtitle={t().emptySubtitle} hideActionButton />
        ) : (
          <div className="overflow-x-auto border border-border-light rounded-md max-w-full">
            <table className="min-w-full text-left text-sm text-typography-900">
              <thead className="text-typography-600 bg-background-secondary">
                <tr>
                  <th className="px-3 py-3 font-medium">{t().columns.name}</th>
                  <th className="px-3 py-3 font-medium">{t().columns.email}</th>
                  <th className="px-3 py-3 font-medium">{t().columns.organisation}</th>
                  <th className="px-3 py-3 font-medium text-right">{t().columns.assistants}</th>
                  <th className="px-3 py-3 font-medium">{t().columns.status}</th>
                  <th className="px-3 py-3 font-medium">{t().columns.added}</th>
                </tr>
              </thead>
              <tbody>
                {logins.map(login => (
                  <tr
                    key={login.id}
                    className="border-t border-border-light cursor-pointer hover:bg-background-secondary"
                    data-testid="custom-login-row"
                    onClick={() => setOpenId(login.id)}
                  >
                    <td className="px-3 py-3 min-w-[140px]">{login.name || login.email}</td>
                    <td className="px-3 py-3 break-all min-w-[160px]">{login.email}</td>
                    <td className="px-3 py-3">{login.organisation ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{login.assistants}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={login.status} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatDate(login.roleGrantedAt ?? login.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <CustomLoginPanel onClose={() => setCreating(false)} />}
      {removeDialog}
    </div>
  );
};
