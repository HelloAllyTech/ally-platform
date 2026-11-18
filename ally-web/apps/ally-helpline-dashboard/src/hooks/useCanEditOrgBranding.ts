import { useGetLogoUrlQuery } from "@api";
import { Permissions } from "@constants";
import { useUser } from "@hooks";
import { hasPermissions } from "@utils";

/**
 * Branding tab visibility for a tenant ADMIN: the `edit:tenant-branding`
 * permission (granted to the ADMIN group by ally-be migration
 * 1980850000000-AddOrgAdminBrandingPermission) AND the org's branding switch,
 * which only an Ally platform admin can turn on. Neither alone is enough —
 * the backend refuses edits while the switch is off, so showing the tab then
 * would only lead to a refusal.
 *
 * Reads the same tenant query the sidebar and BrandingProvider already hold,
 * so no extra request; it is skipped entirely without the permission.
 */
export const useCanEditOrgBranding = () => {
  const { permissions } = useUser();
  const hasPermission = hasPermissions(permissions, Permissions.EDIT_TENANT_BRANDING);

  const { data: tenant, isLoading } = useGetLogoUrlQuery(undefined, { skip: !hasPermission });

  return {
    canEdit: hasPermission && Boolean(tenant?.branding?.enabled) && Boolean(tenant?.id),
    isLoading: hasPermission && isLoading,
  };
};
