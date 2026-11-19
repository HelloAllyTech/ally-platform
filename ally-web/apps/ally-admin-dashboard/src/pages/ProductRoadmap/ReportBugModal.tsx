import React from "react";

import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

import { BugReportForm, BugReportSubmitError, detectDeviceOs } from "@ally-ui-mono/ui-shared";
import { useCreateRoadmapBugReportMutation } from "@api";
import { RoadmapBugReportContext } from "@types";

interface ReportBugModalProps {
  onClose: () => void;
}

/**
 * "Report a bug" in the admin dashboard — the very same form end users get from helpline's
 * "Report a problem": one free-text box, posted to the same `POST /product-roadmap/bug-reports`,
 * into the same Bug Hunter pipeline. Only where it is opened from (and that it opens full-screen)
 * differs.
 *
 * It used to ask staff three required questions (what they expected, where they saw it) and a
 * page of optional ones (steps, when, how often, how bad, ids, which codebase). That was cut
 * back on 2026-11-19 to the one box: the reporter describes it in their own words, and
 * everything the app can work out for itself — screen, device, OS, time — is captured
 * silently and handed to Bug Hunter and whoever fixes it, never asked for. `source` is still
 * stamped server-side from the reporter's roles, and Bug Hunter picks the repo itself.
 */
export const ReportBugModal: React.FC<ReportBugModalProps> = ({ onClose }) => {
  const location = useLocation();
  const [createBugReport] = useCreateRoadmapBugReportMutation();

  const handleSubmit = async (description: string) => {
    const context: RoadmapBugReportContext = {
      // The query string too: on the roadmap the open tab and drawer live in ?view= and
      // friends, so a bare path would not say which of its screens broke.
      screen: `${location.pathname}${location.search}`,
      ...detectDeviceOs(),
      clientTimestamp: new Date().toISOString(),
    };
    try {
      await createBugReport({ description, context }).unwrap();
    } catch (error) {
      const fetchError = error as FetchBaseQueryError & { data?: { statusCode?: number } };
      const submitError: BugReportSubmitError = {
        rateLimited: fetchError?.status === 429 || fetchError?.data?.statusCode === 429,
      };
      throw submitError;
    }
  };

  return (
    <BugReportForm
      open
      fullScreen
      onClose={onClose}
      onSubmit={handleSubmit}
      onSuccess={() => {
        toast.success("Bug reported. Bug Hunter has it; it will confirm it and get back to you.");
        onClose();
      }}
      labels={{ title: "Report a bug" }}
    />
  );
};
