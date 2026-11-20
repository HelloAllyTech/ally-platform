import { useState } from "react";

import { Permissions } from "@constants";
import { useUser } from "@hooks";

import { BlogClaudeConnectSheet } from "./BlogClaudeConnectSheet";

/** Whether the signed-in person may create and edit blog posts. */
export const useCanEditBlogs = (): boolean => {
  const { permissions } = useUser();
  return !!permissions?.includes(Permissions.EDIT_BLOG);
};

/** The sheet's open state, for the Blog page to wire into its header. */
export const useBlogClaudeConnect = () => {
  const canConnect = useCanEditBlogs();
  const [open, setOpen] = useState(false);
  return { canConnect, open, openSheet: () => setOpen(true), closeSheet: () => setOpen(false) };
};

/** Renders the sheet when open; nothing for people who cannot edit blogs. */
export const BlogClaudeConnect: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const canEdit = useCanEditBlogs();
  return canEdit && open ? <BlogClaudeConnectSheet onClose={onClose} /> : null;
};
