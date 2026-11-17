import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import {
  useAddClinicalAdvisorMutation,
  useAddDebriefOwnerMutation,
  useGetAdminTenantsQuery,
  useGetUserFeatureTogglesQuery,
  useListClinicalAdvisorsQuery,
  useRemoveClinicalAdvisorMutation,
  useRemoveDebriefOwnerMutation,
  useSetUserFeatureTogglesMutation,
} from "@api";
import { ArrowDown } from "@assets";
import { AssignedOrganizations, Button, ToggleSwitch } from "@components";
import { ButtonVariant } from "@components/types";
import {
  en,
  FEATURE_TOGGLE_SECTION_ORDER,
  FEATURE_TOGGLE_KEY_TO_SECTION,
  DEFAULT_FEATURE_TOGGLE_SECTION,
  FeatureToggleKey,
} from "@constants";
import { PlatformAdmin, UserFeatureToggle } from "@types";

const strings = en.superAdmins;

/**
 * The person's two Debrief roles as switches (moved here from User Management › Debrief access):
 * each flip grants or removes the role at once through the same endpoints, and ally-be keeps the
 * Debriefs console access in step (on with the first role, off with the last).
 */
export const DebriefRoleSwitches: React.FC<{ userId: number; name: string }> = ({
  userId,
  name,
}) => {
  const { data: people, isLoading, isError } = useListClinicalAdvisorsQuery();
  const [addAdvisor] = useAddClinicalAdvisorMutation();
  const [removeAdvisor] = useRemoveClinicalAdvisorMutation();
  const [addOwner] = useAddDebriefOwnerMutation();
  const [removeOwner] = useRemoveDebriefOwnerMutation();
  const [busy, setBusy] = useState<"advisor" | "owner" | null>(null);
  const me = people?.find(p => p.userId === userId);
  const done = en.debriefAccess.done;
  const failed = en.debriefAccess.failed;

  const flip = async (role: "advisor" | "owner", on: boolean) => {
    const call =
      role === "advisor" ? (on ? addAdvisor : removeAdvisor) : on ? addOwner : removeOwner;
    setBusy(role);
    try {
      await call(userId).unwrap();
      toast.success(
        role === "advisor"
          ? on
            ? done.addAdvisor(name)
            : done.removeAdvisor(name)
          : on
            ? done.addOwner(name)
            : done.removeOwner(name),
      );
    } catch (error: any) {
      // ally-be says why in words.
      toast.error(error?.data?.message || (on ? failed.add : failed.remove));
    } finally {
      setBusy(null);
    }
  };

  const rows = [
    {
      key: "advisor" as const,
      label: strings.debriefAdvisor,
      help: strings.debriefAdvisorHelp,
      enabled: !!me?.advisor,
    },
    {
      key: "owner" as const,
      label: strings.debriefOwner,
      help: strings.debriefOwnerHelp,
      enabled: !!me?.owner,
    },
  ];

  return (
    <section className="flex flex-col gap-1" data-testid="admin-debrief-roles">
      <h3 className="text-base font-secondary text-typography-900 mb-2">
        {strings.debriefsSection}
      </h3>
      {isError ? (
        <p className="text-sm text-typography-600">{strings.debriefRolesLoadFailed}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border-light border border-border-light rounded-md">
          {rows.map(r => (
            <div
              key={r.key}
              data-testid={`admin-debrief-role-${r.key}`}
              className="flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-typography-900">{r.label}</p>
                <p className="text-sm text-typography-600">{r.help}</p>
              </div>
              <ToggleSwitch
                enabled={r.enabled}
                disabled={isLoading || busy !== null}
                onChange={enabled => void flip(r.key, enabled)}
                label={r.label}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

interface PlatformAdminDetailProps {
  admin: PlatformAdmin;
  onBack: () => void;
}

/**
 * Detail view for one platform admin: their full feature-toggle matrix,
 * grouped into sections, plus the tenant-allowlist control. Reached by
 * clicking a row in `SuperAdmins`. Each toggle PATCHes immediately on change
 * (one call per flip) with an optimistic update + rollback on failure,
 * mirroring `SimulationsTab`'s `handleToggleAccess` / `EntityToggleCard`.
 */
export const PlatformAdminDetail: React.FC<PlatformAdminDetailProps> = ({ admin, onBack }) => {
  const { data: togglesData, isLoading: isTogglesLoading } = useGetUserFeatureTogglesQuery(
    admin.id,
  );
  const [setUserFeatureToggles] = useSetUserFeatureTogglesMutation();
  const [toggles, setToggles] = useState<UserFeatureToggle[]>([]);

  useEffect(() => {
    setToggles(togglesData ?? []);
  }, [togglesData]);

  // Any assigned organization restricts this admin, and the backend then
  // withholds every platform-only toggle from them — so say so on those rows
  // rather than show a switch that is on but does nothing. Same query the
  // allowlist control below makes, so RTK serves both from one request.
  const { data: adminTenantsData } = useGetAdminTenantsQuery(admin.id);
  const isRestricted = (adminTenantsData?.count ?? 0) > 0;

  const handleToggle = async (key: string, enabled: boolean) => {
    setToggles(prev => prev.map(t => (t.key === key ? { ...t, enabled } : t)));
    try {
      await setUserFeatureToggles({
        userId: admin.id,
        toggles: [{ featureKey: key, enabled }],
      }).unwrap();
    } catch (error: any) {
      setToggles(prev => prev.map(t => (t.key === key ? { ...t, enabled: !enabled } : t)));
      toast.error(error?.data?.message || strings.toggleUpdateError);
    }
  };

  const grouped = FEATURE_TOGGLE_SECTION_ORDER.map(section => ({
    section,
    items: toggles.filter(
      t =>
        // The Debriefs console access follows the Debrief roles (on with the first, off with
        // the last), so it is not a switch of its own here; the Debriefs section sets it.
        t.key !== FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF &&
        (FEATURE_TOGGLE_KEY_TO_SECTION[t.key] ?? DEFAULT_FEATURE_TOGGLE_SECTION) === section,
    ),
  })).filter(group => group.items.length > 0);

  return (
    <div className="py-[2px] font-primary md:overflow-y-auto md:h-[calc(100vh-220px)]">
      <div className="flex items-center gap-2 text-sm mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 min-h-[40px] md:min-h-0 text-typography-800 hover:text-typography-900"
        >
          <span className="rotate-90">
            <ArrowDown />
          </span>
          {strings.backToPlatformAdmins}
        </button>
      </div>

      <h2 className="text-xl text-typography-900 font-secondary mb-1 break-words">
        {admin.name || admin.email}
      </h2>
      <p className="text-sm text-typography-600 pb-6">
        {strings.toggleDetailSubtitle(admin.name || admin.email)}
      </p>

      {isTogglesLoading ? (
        <div className="py-12 text-center text-typography-600">{strings.loadingToggles}</div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(group => (
            <section key={group.section} className="flex flex-col gap-1">
              <h3 className="text-base font-secondary text-typography-900 mb-2">{group.section}</h3>
              <div className="flex flex-col divide-y divide-border-light border border-border-light rounded-md">
                {group.items.map(item => (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-typography-900">{item.label}</p>
                      <p className="text-sm text-typography-600">{item.description}</p>
                      {isRestricted && item.platformOnly && (
                        <p className="text-sm text-typography-800 mt-1">
                          {strings.platformOnlyWhileRestricted}
                        </p>
                      )}
                    </div>
                    <ToggleSwitch
                      enabled={item.enabled}
                      onChange={enabled => handleToggle(item.key, enabled)}
                      label={item.label}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <DebriefRoleSwitches userId={admin.id} name={admin.name || admin.email} />

          <section className="flex flex-col gap-2">
            <div>
              <h3 className="text-base font-secondary text-typography-900">
                {strings.tenantAllowlistTitle}
              </h3>
              <p className="text-sm text-typography-600">{strings.tenantAllowlistSubtitle}</p>
            </div>
            <div className="border border-border-light rounded-md p-4">
              <AssignedOrganizations userId={admin.id} canEdit />
            </div>
          </section>
        </div>
      )}

      <div className="mt-6">
        <Button variant={ButtonVariant.SECONDARY} onClick={onBack}>
          {strings.backToPlatformAdmins}
        </Button>
      </div>
    </div>
  );
};
