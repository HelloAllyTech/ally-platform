import React from "react";

import { Permissions, en } from "@constants";
import { useUser } from "@hooks";

import { BugsTab } from "../ProductRoadmap/BugsTab";
import { InterviewsTab } from "../ProductRoadmap/InterviewsTab";
import { RoadmapAreaHeader } from "./components/RoadmapAreaHeader";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { canManageRoadmap } from "../ProductRoadmap/utils/access";

/** Roadmap → Bugs (§4.1): Bug Hunter's table, read-only and unchanged. */
export const RoadmapBugsPage: React.FC = () => {
  const phone = useRoadmapBreakpoint() === "phone";
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <RoadmapAreaHeader phone={phone} current={en.roadmapV2.mobile.bugs} />
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${phone ? "pb-24" : ""}`}>
        <BugsTab />
      </div>
      {phone && <RoadmapBottomBar hidden={false} />}
    </div>
  );
};

/**
 * User Interviews, its own sidebar entry (D14): the existing `InterviewsTab`, unchanged inside.
 * Voting and managing keep the board's rules (the VOTE permission; manage = permission AND toggle).
 */
export const UserInterviewsPage: React.FC = () => {
  const { user, permissions, features } = useUser();
  const copy = en.roadmapV2Tools.interviews;
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="m-0 text-xl font-semibold text-typography-900">{copy.title}</h1>
        <p className="m-0 mt-1 text-sm text-typography-600">{copy.intro}</p>
      </header>
      <InterviewsTab
        canVote={!!permissions?.includes(Permissions.VOTE_PRODUCT_ROADMAP)}
        canManage={canManageRoadmap(permissions, features)}
        currentUserId={user?.id}
      />
    </div>
  );
};
