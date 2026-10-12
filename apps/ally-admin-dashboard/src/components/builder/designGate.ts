import { BuilderDesignReadiness, BuilderTechnicalDesign } from "@types";

/**
 * Why a build may not start yet on account of the technical design, or null
 * when it may. The backend enforces the same rule on start-build; this is how
 * the start dialog says so before the request rather than after it.
 */
export const designBuildBlock = (
  design: BuilderTechnicalDesign | null | undefined,
  designReadiness: BuilderDesignReadiness | null | undefined,
): "notApproved" | "stale" | null => {
  if (design?.status !== "approved") return "notApproved";
  if (designReadiness?.stale) return "stale";
  return null;
};
