import React from "react";

import { useGetMyPlanQuery } from "@api";
import { ROUTES } from "@constants";

import { PLAN } from "../../pages/Plan/copy";

/**
 * "Plan and usage" in the account menu (CR1 Part C): only for someone with a plan (a chatbot
 * creator). Everyone else has nothing to see there.
 */
export const PlanMenuItem: React.FC<{ onOpen: (path: string) => void }> = ({ onOpen }) => {
  const { data } = useGetMyPlanQuery();
  if (!data?.isCreator) return null;
  return (
    <button
      role="menuitem"
      onClick={() => onOpen(ROUTES.MY_PLAN)}
      className="flex flex-row items-center w-full px-4 py-2 gap-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
      data-testid="menu-plan-and-usage"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
        <path
          d="M4 16V9M10 16V4M16 16v-5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span>{PLAN.menuItem}</span>
    </button>
  );
};
