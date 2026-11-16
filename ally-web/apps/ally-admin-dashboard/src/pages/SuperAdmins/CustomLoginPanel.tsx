import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  useAddUserMutation,
  useAssignPlatformAdminMutation,
  useGetFeatureToggleRegistryQuery,
  useGetTenantsQuery,
  useGetUserFeatureTogglesQuery,
  useSetUserFeatureTogglesMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import type { PlatformAdmin } from "@types";

import { FeatureToggleKey } from "../../constants/featureToggles";

const t = () => en.customLogins;
const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/**
 * The least role the create-user route accepts (one permission). What the login can actually use
 * comes from its toggles: it is made a platform admin, then every toggle is set to what was ticked.
 */
export const CUSTOM_LOGIN_BASE_ROLE = "EVALUATOR";

const reason = (error: unknown): string =>
  String(
    (error as { data?: { message?: string | string[] } })?.data?.message ??
      (error as Error)?.message ??
      "unknown error",
  );

/**
 * Create a custom login, or edit what one can use (A1). Creating runs three existing routes in
 * order: POST /v1/users → POST /v1/platform-admins → PATCH /v1/users/:id/feature-toggles, the last
 * with EVERY key set to exactly what was ticked (so default-on keys are switched off too). If a
 * step fails, the message says which, and what is left to do.
 *
 * Shown only inside Ally admins, which needs the admin_user_management toggle; the server refuses
 * the three routes to anyone without it.
 */
export const CustomLoginPanel: React.FC<{
  edit?: PlatformAdmin;
  onClose: () => void;
}> = ({ edit, onClose }) => {
  const { data: registry, isLoading: registryLoading } = useGetFeatureToggleRegistryQuery();
  const { data: current } = useGetUserFeatureTogglesQuery(edit?.id ?? 0, { skip: !edit });
  const { data: tenants } = useGetTenantsQuery({ limit: 500 }, { skip: Boolean(edit) });
  const [addUser] = useAddUserMutation();
  const [assignPlatformAdmin] = useAssignPlatformAdminMutation();
  const [setToggles] = useSetUserFeatureTogglesMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(edit ? [] : [FeatureToggleKey.WHATSAPP_BOT]),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editing: prefilled with what they can use now.
  useEffect(() => {
    if (edit && current) setTicked(new Set(current.filter(x => x.enabled).map(x => x.key)));
  }, [edit, current]);

  // Chatbots first, then the rest in the registry's order.
  const entries = useMemo(() => {
    const all = registry ?? [];
    const chatbots = all.filter(e => e.key === FeatureToggleKey.WHATSAPP_BOT);
    return [...chatbots, ...all.filter(e => e.key !== FeatureToggleKey.WHATSAPP_BOT)];
  }, [registry]);

  const toggle = (key: string) =>
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allToggles = () => entries.map(e => ({ featureKey: e.key, enabled: ticked.has(e.key) }));

  const save = async () => {
    setProblem(null);
    if (!edit) {
      if (!name.trim()) return setProblem(t().needName);
      if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) return setProblem(t().needEmail);
      if (!tenantId) return setProblem(t().needOrganisation);
    }
    if (!ticked.size) return setProblem(t().pickOne);
    setSaving(true);
    try {
      let userId = edit?.id;
      if (!edit) {
        try {
          const created = await addUser({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            roles: [CUSTOM_LOGIN_BASE_ROLE],
            externalId: "",
            tenantId,
          }).unwrap();
          userId = created.id;
        } catch (error) {
          return setProblem(fill(t().failedCreate, { reason: reason(error) }));
        }
        try {
          await assignPlatformAdmin({ userId: userId! }).unwrap();
        } catch (error) {
          return setProblem(fill(t().failedAdmin, { reason: reason(error) }));
        }
      }
      try {
        await setToggles({ userId: userId!, toggles: allToggles() }).unwrap();
      } catch (error) {
        return setProblem(fill(t().failedFeatures, { reason: reason(error) }));
      }
      toast.success(edit ? t().saved : t().created);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 md:px-0">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-login-title"
        data-testid="custom-login-panel"
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden bg-white p-4 shadow-xl md:p-6"
      >
        <h2 id="custom-login-title" className="mb-2 font-secondary text-xl text-typography-900">
          {edit ? fill(t().editTitle, { name: edit.name || edit.email }) : t().create}
        </h2>
        <p className="mb-4 text-sm text-typography-600">{t().intro}</p>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {!edit && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                {t().name}
                <input
                  className="border border-border-dark px-3 py-2 outline-none"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  data-testid="custom-login-name"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t().email}
                <input
                  type="email"
                  className="border border-border-dark px-3 py-2 outline-none"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  data-testid="custom-login-email"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t().organisation}
                <select
                  className="border border-border-dark px-3 py-2 outline-none"
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  data-testid="custom-login-organisation"
                >
                  <option value="">{t().choose}</option>
                  {(tenants?.data ?? []).map(tenant => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-typography-600">{t().organisationHint}</span>
              </label>
            </>
          )}
          <fieldset className="flex flex-col gap-2" data-testid="custom-login-features">
            <legend className="mb-1 text-sm font-medium text-typography-900">
              {t().whatCanTheyUse}
            </legend>
            {registryLoading ? (
              <span className="text-sm text-typography-600">{t().loading}</span>
            ) : (
              entries.map(entry => {
                const isChatbots = entry.key === FeatureToggleKey.WHATSAPP_BOT;
                return (
                  <label key={entry.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ticked.has(entry.key)}
                      onChange={() => toggle(entry.key)}
                      data-testid={`custom-login-feature-${entry.key}`}
                    />
                    <span className="flex flex-col">
                      <span className="text-typography-900">
                        {isChatbots ? t().chatbots : entry.label}
                      </span>
                      <span className="text-xs text-typography-600">
                        {isChatbots ? t().chatbotsHint : entry.description}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </fieldset>
        </div>
        {problem && (
          <p
            role="alert"
            className="mt-3 text-sm text-error-600"
            data-testid="custom-login-problem"
          >
            {problem}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant={ButtonVariant.SECONDARY} onClick={onClose}>
            {t().cancel}
          </Button>
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => void save()}
            disabled={saving || registryLoading}
            data-testid="custom-login-save"
          >
            {edit ? t().saveEdit : t().save}
          </Button>
        </div>
      </div>
    </div>
  );
};
