/**
 * Value sets for the auto-release policy's log (`release_policy_log`, Roadmap
 * v2 P5). Stored as `character varying` with CHECK constraints, per ally-be
 * convention.
 */

/** What a log row records. */
export enum ReleasePolicyLogKind {
  /** What the policy decided for one service, written when the decision changes. */
  DECISION = 'decision',
  /** A production release run the policy saw finish, whoever started it. */
  OBSERVED_RELEASE = 'observed_release',
  /** A person clicked Release (`POST /v1/roadmap/release`). */
  MANUAL_RELEASE = 'manual_release',
  /** The circuit breaker tripped, would have tripped (shadow), or was resumed. */
  BREAKER = 'breaker',
}

/**
 * Whether the policy acts. Only `shadow` is reachable in P5: it computes and
 * logs, and never dispatches. `live` exists so the later switch is one line.
 */
export enum ReleasePolicyMode {
  SHADOW = 'shadow',
  LIVE = 'live',
  /** A person's Release click, which works in every mode. */
  MANUAL = 'manual',
}

/** The policy's answer for one service, most blocking first. */
export enum ReleasePolicyDecision {
  /** Would release now (shadow: "would release be-v… with these commits"). */
  RELEASE = 'release',
  /** A commit in the range touches a held path: it waits for a Release click. */
  HELD = 'held',
  /** The circuit breaker is open: auto-release is paused platform-wide. */
  PAUSED = 'paused',
  /** Less than the debounce since the last merge to this service. */
  DEBOUNCING = 'debouncing',
  /** Outside the Owner-set release window. */
  OUTSIDE_WINDOW = 'outside_window',
  /** A frontend waiting for this cycle's backends to release and report healthy. */
  WAITING_BACKEND = 'waiting_backend',
  /** Nothing unreleased for this service. */
  NOTHING = 'nothing',
  /** The range could not be read in full this pass; nothing is decided on partial data. */
  UNKNOWN = 'unknown',
}

/** How a release run ended. */
export enum ReleasePolicyOutcome {
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

/** Who started an observed release. */
export enum ReleasePolicyOrigin {
  /** A person or another automation, outside this policy (`/ship`, Builder, by hand). */
  HUMAN = 'human',
  /** A Release click through `POST /v1/roadmap/release`. */
  MANUAL_CLICK = 'manual_click',
  /** The policy itself, once live. Never written in P5. */
  POLICY = 'policy',
}

/**
 * The cutover check, per observed release: did the policy want to ship exactly
 * this? `match` = its last decision for the service before the release started
 * was `release`, and the release contains no service commit the policy had not
 * seen. Otherwise, why not.
 */
export enum ReleasePolicyComparison {
  MATCH = 'match',
  /** The policy wanted to release, but the human release carried other service commits. */
  DIFFERENT_HEAD = 'different_head',
  /** The policy had logged nothing for the service before this release. */
  NO_DECISION = 'no_decision',
  POLICY_HELD = 'policy_held',
  POLICY_PAUSED = 'policy_paused',
  POLICY_DEBOUNCING = 'policy_debouncing',
  POLICY_OUTSIDE_WINDOW = 'policy_outside_window',
  POLICY_WAITING_BACKEND = 'policy_waiting_backend',
  POLICY_NOTHING = 'policy_nothing',
  POLICY_UNKNOWN = 'policy_unknown',
}

/** What a breaker row says. */
export enum ReleasePolicyBreakerEvent {
  TRIPPED = 'tripped',
  /** Shadow mode: two consecutive failed or unhealthy releases, so live mode would have paused. */
  WOULD_TRIP = 'would_trip',
  RESUMED = 'resumed',
}
