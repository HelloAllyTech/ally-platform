import {
  CAPABILITY_LABELS,
  CapabilitySignal,
  ChartRequirement,
  RETIRED_TENANT_CHARTS,
  SHAPE_ALLOWED_CHARTS,
  TENANT_CHART_LIBRARY,
  TenantChartEntry,
} from '../constants/tenant-chart-library.constants';

/** The counts one tenant's data gives, keyed by signal. */
export type TenantCapabilities = Record<CapabilitySignal, number>;

export type ChartAvailabilityState = 'available' | 'sparse' | 'unavailable';

export interface ChartAvailability {
  state: ChartAvailabilityState;
  /** Why a chart is `sparse` or `unavailable`; null when `available`. */
  reason: string | null;
}

/** "Needs at least 5 course enrolments (you have 2)." */
function describeShortfall(req: ChartRequirement, have: number): string {
  const label = CAPABILITY_LABELS[req.signal];
  const noun = req.min === 1 ? label.singular : label.plural;
  return `Needs at least ${req.min} ${noun} (you have ${have}).`;
}

/**
 * Decides whether one tenant can use one chart.
 *
 * - every requirement met            → `available`
 * - else every requirement at least at its `sparseMin` → `sparse`
 *   (a requirement with no `sparseMin` can never be sparse)
 * - otherwise                         → `unavailable`, with the first shortfall
 *
 * A chart with no requirements is always available.
 */
export function resolveChartAvailability(
  entry: Pick<TenantChartEntry, 'needs'>,
  capabilities: TenantCapabilities,
): ChartAvailability {
  const unmet = entry.needs.filter((r) => capabilities[r.signal] < r.min);
  if (unmet.length === 0) return { state: 'available', reason: null };

  const hardMiss = unmet.find(
    (r) => r.sparseMin === undefined || capabilities[r.signal] < r.sparseMin,
  );
  if (hardMiss) {
    return {
      state: 'unavailable',
      reason: describeShortfall(hardMiss, capabilities[hardMiss.signal]),
    };
  }
  const first = unmet[0];
  return {
    state: 'sparse',
    reason: `Small sample: showing counts only. ${describeShortfall(first, capabilities[first.signal])}`,
  };
}

/** True when a tenant may see the chart at all (visibility allow-list). */
export function isChartVisibleToTenant(
  entry: Pick<TenantChartEntry, 'visibility'>,
  tenantId: string,
): boolean {
  return entry.visibility === 'all' || entry.visibility.includes(tenantId);
}

/**
 * Problems with the registry itself, as human-readable strings. Empty when the
 * registry is sound. Used by the unit test so a bad entry fails CI.
 */
export function validateChartLibrary(
  library: readonly TenantChartEntry[] = TENANT_CHART_LIBRARY,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  library.forEach((entry, index) => {
    if (!/^TSQ-\d{3}$/.test(entry.id)) {
      problems.push(`${entry.id}: id must look like TSQ-001`);
    }
    if (seen.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    seen.add(entry.id);
    // Ids only ever grow (gaps are retired charts), so the order is the history.
    const number = Number(entry.id.slice(4));
    const previous = index > 0 ? Number(library[index - 1].id.slice(4)) : 0;
    if (number <= previous) {
      problems.push(`${entry.id}: ids must be in increasing order`);
    }
    if (RETIRED_TENANT_CHARTS[entry.id]) {
      problems.push(`${entry.id}: this id was retired and must not be reused`);
    }
    if (entry.scopes.length === 0) {
      problems.push(`${entry.id}: needs at least one scope`);
    }
    if (!SHAPE_ALLOWED_CHARTS[entry.shape].includes(entry.chart)) {
      problems.push(
        `${entry.id}: chart "${entry.chart}" is not allowed for shape "${entry.shape}"`,
      );
    }
    if (entry.sources.length === 0) {
      problems.push(`${entry.id}: needs at least one source`);
    }
    if (entry.live && entry.blockedBy) {
      problems.push(`${entry.id}: a live chart cannot be blocked`);
    }
    entry.needs.forEach((r) => {
      if (r.min < 1) problems.push(`${entry.id}: ${r.signal} min must be >= 1`);
      if (r.sparseMin !== undefined && r.sparseMin >= r.min) {
        problems.push(`${entry.id}: ${r.signal} sparseMin must be below min`);
      }
    });
  });
  return problems;
}
