import React, { useRef, useState } from "react";

import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import { User } from "@assets";
import { UserModal } from "@components/user-modal";
import { ROUTES, en, profileSettings, USER_MODAL_FIELDS_IDS } from "@constants";
import { useClickOutside, useUser } from "@hooks";

const t = () => en.assistantsShell;

/**
 * The assistants area's slim header (A1): no Ally admin navigation. "Your assistants" on the left;
 * the account menu (profile, sign out, and Ally admin for people who also have it) on the right.
 * The assistant switcher sits in each assistant's own header, beside its name.
 */
export const AssistantsHeader: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    logout,
    filteredNavigationItems,
    getProfileUrl,
    deleteProfile,
    uploadProfileImage,
    refetchUser,
  } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useClickOutside(menu, () => setMenuOpen(false));

  const form = useForm({ defaultValues: { profileImageUrl: "" }, mode: "onChange" });
  const imageUploaded = form.watch("profileImageUrl");
  const uploadProfile = async () => {
    const existing = user?.profileImageUrl;
    await uploadProfileImage({ profileImageUrl: imageUploaded });
    if (existing) await deleteProfile({ profileImageUrl: existing });
    await refetchUser();
    setProfileOpen(false);
  };

  // Ally admin, for people who have something there besides their assistants.
  const adminHome = filteredNavigationItems?.[0]?.path;

  return (
    <header
      data-testid="assistants-header"
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border-light bg-white px-4"
    >
      <Link
        to={ROUTES.WHATSAPP_BOT}
        className="ally-label text-typography-900 hover:underline"
        data-testid="assistants-header-home"
      >
        {t().yourAssistants}
      </Link>
      <div ref={menu} className="relative ml-auto">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
          data-testid="assistants-account-button"
          className="inline-flex h-11 items-center gap-2 rounded-md px-2 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
            {user?.profileImageUrl ? (
              <CustomImage
                src={user.profileImageUrl}
                alt=""
                containerClassName="h-full w-full"
                fallbackClassName="flex h-full w-full items-center justify-center rounded-full bg-neutral-100 text-typography-600"
                fallbackText="NA"
              />
            ) : (
              <User />
            )}
          </span>
          <span className="max-w-[12rem] truncate text-sm text-typography-900 max-sm:hidden">
            {user?.name ?? user?.email}
          </span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            data-testid="assistants-account-menu"
            className="absolute right-0 top-12 z-50 min-w-[220px] rounded-lg border border-border-light bg-white py-1 shadow-lg"
          >
            <p className="truncate px-4 py-2 text-xs text-typography-700">{user?.email}</p>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setProfileOpen(true);
              }}
              className="block w-full px-4 py-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
            >
              {en.auth.profileSettings}
            </button>
            {adminHome && (
              <button
                type="button"
                role="menuitem"
                onClick={() => navigate(adminHome)}
                data-testid="assistants-account-admin"
                className="block w-full px-4 py-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
              >
                {t().allyAdmin}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                logout();
                navigate(ROUTES.LOGIN);
              }}
              data-testid="assistants-account-signout"
              className="block w-full px-4 py-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
            >
              {t().signOut}
            </button>
          </div>
        )}
      </div>
      <UserModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        title={en.auth.profileSettings}
        imageUpload
        fields={profileSettings}
        details={user}
        uploadTitle={en.auth.profileImage}
        handleClick={uploadProfile}
        formMethods={form}
        uploadId={USER_MODAL_FIELDS_IDS.PROFILE}
        uploadButtonName={imageUploaded ? en.userManagement.changeImage : en.auth.uploadImage}
        uploadImageUrl={getProfileUrl}
      />
    </header>
  );
};
