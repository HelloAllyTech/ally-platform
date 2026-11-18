import {
  useGetCharacterLibraryEnabledQuery,
  useGetFeatureTogglesQuery,
  useGetPermissionsQuery,
  useGetUserPreferencesQuery,
} from "@api";
import { OrgToggle, SIDEBAR_ITEMS } from "@constants";
import { deriveNavigationItems } from "@utils/navigation";

/**
 * Someone whose only way in is an assistant's team (chunk 6b, item 31): nothing in the admin
 * navigation but, at most, Assistants. They see their assistant and nothing else: no Sidebar, no
 * other page. `ready` is false until their permissions and switches are known, so an admin never
 * sees the Sidebar disappear while those load.
 */
export function useAssistantOnly(): { ready: boolean; assistantOnly: boolean } {
  const permissions = useGetPermissionsQuery();
  const features = useGetFeatureTogglesQuery();
  const preferences = useGetUserPreferencesQuery();
  const characterLibrary = useGetCharacterLibraryEnabledQuery();
  const ready =
    !permissions.isLoading &&
    !features.isLoading &&
    !permissions.isError &&
    !features.isError &&
    !preferences.isLoading;
  if (!ready) return { ready, assistantOnly: false };
  const items = deriveNavigationItems({
    permissions: permissions.data ?? [],
    features: features.data ?? [],
    savedOrder: preferences.data?.admin_sidebar_order,
    orgToggles: { [OrgToggle.CHARACTER_LIBRARY]: Boolean(characterLibrary.data) },
  });
  return {
    ready,
    assistantOnly: items.every(item => item.id === SIDEBAR_ITEMS.WHATSAPP_BOT),
  };
}
