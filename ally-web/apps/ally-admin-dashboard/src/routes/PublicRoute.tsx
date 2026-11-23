import React from "react";

import { Navigate, useLocation } from "react-router-dom";

import { LOCAL_STORAGE_KEYS } from "@constants";

import { afterLoginPath } from "../utils/loginRedirect";

interface PublicRouteProps {
  children: React.ReactNode;
}

export const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { search } = useLocation();
  // In a real application, you would check authentication status here
  // For now, we'll use a simple localStorage check
  const isAuthenticated =
    localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";

  if (isAuthenticated) {
    // Back to the page they opened (`?next=`, A1), else through the root so DefaultRedirect
    // lands the user on their first tab.
    return <Navigate to={afterLoginPath(search)} replace />;
  }

  return <>{children}</>;
};
