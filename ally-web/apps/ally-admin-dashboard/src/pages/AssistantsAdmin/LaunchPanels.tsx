import React from "react";

import { Link } from "react-router-dom";

import { InlineNotification, Tag, Tile } from "@ally-ui-mono/ui-shared";
import { ROUTES } from "@constants";

import { assistantsAdminPath, type SectionId } from "./sections";

/**
 * Launch & data: the jobs that run outside this screen today. Nothing here changes data; it says
 * what each switch and step does, in what order, and what can't be undone. Source of truth is
 * `ally-be/docs/assistants-cutover-runbook.md`; keep the two in step.
 */

const go = (section: SectionId, view?: string) =>
  assistantsAdminPath(ROUTES.ASSISTANTS_ADMIN, section, view);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="aa-code">{children}</code>
);

const Block: React.FC<{ children: string }> = ({ children }) => (
  <pre className="aa-pre">{children}</pre>
);

const Outside: React.FC = () => (
  <InlineNotification
    kind="info"
    lowContrast
    hideCloseButton
    title="These run outside this screen."
    subtitle="Nothing on this page changes data. It tells you what to run and in what order. The runbook has not been run against production yet, so rehearse it on a copy first."
  />
);

/* ---------- Kill switches ---------- */

interface Switch {
  name: string;
  off: string;
  how: "db" | "server";
  note?: string;
}

const GROUPS: { title: string; blurb: string; items: Switch[] }[] = [
  {
    title: "Money",
    blurb: "Credits and spend.",
    items: [
      {
        name: "assistant_credits (enforcement, warningEmails)",
        off: "Old limits apply exactly (plans, seats, spend cap). Spend is still recorded. The 50, 80 and 95 percent warning emails stop.",
        how: "db",
        note: "Off in production until the row exists. Takes effect within 30 seconds.",
      },
      {
        name: "ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF",
        off: "A stopped usage feed no longer blocks new spend: work goes ahead with its cost unrecorded, and one warning an hour is logged.",
        how: "server",
        note: "Work paused by the credits gate resumes on its own after a grant. To resume it without one: POST /v1/staff/billing/credits/resume-paused.",
      },
    ],
  },
  {
    title: "Safety and people",
    blurb: "Alerts, crisis handling and who can see what.",
    items: [
      {
        name: "ASSISTANT_ALERT_SENDING_ENABLED",
        off: "Email, WhatsApp and Slack alerts stop. Rows wait in the outbox, nothing is lost.",
        how: "server",
      },
      {
        name: "ASSISTANT_CRISIS_JOB_ENABLED",
        off: "The one-minute job stops: no holding message, no 'no one is available' message, no untaken-flag timer.",
        how: "server",
      },
      {
        name: "ASSISTANT_GO_LIVE_GATE_ENABLED",
        off: "The go-live gate stops being enforced on publish, status change and page toggle. The checklist still reads.",
        how: "server",
      },
      {
        name: "ASSISTANT_PACK_RELEASES_ENABLED",
        off: "Safety packs are served from the code constants again, not their current release.",
        how: "server",
      },
      {
        name: "RESPONDER_AGREEMENT_ENFORCED",
        off: "The server no longer requires the responder agreement before take-over, reply or read.",
        how: "server",
        note: "Release the backend with this off, then turn it back on once the dashboard is live.",
      },
      {
        name: "ASSISTANT_STAFF_VIEW_ENABLED",
        off: "Staff's read-only view of any chatbot stops: staff reads answer 404. Owners' grants are kept.",
        how: "server",
      },
      {
        name: "ASSISTANT_KNOWLEDGE_PII_REVIEW_ENABLED",
        off: "Uploads are no longer held for personal-data review.",
        how: "server",
      },
      {
        name: "STAFF_DENY_GUARD_ENABLED",
        off: "The staff deny guard on platform routes stops.",
        how: "server",
      },
    ],
  },
  {
    title: "Data jobs",
    blurb: "Refuse to run when off.",
    items: [
      {
        name: "ASSISTANT_RETENTION_SWEEP_ENABLED",
        off: "The retention sweep refuses to run. It is also blocked until the crisis backfill is done.",
        how: "server",
      },
      {
        name: "ASSISTANT_MEMORY_CUTOVER_ENABLED",
        off: "Memory deletion refuses to run. A dry run still counts.",
        how: "server",
      },
      {
        name: "ASSISTANT_UNPUBLISH_BACKFILL_ENABLED",
        off: "The unpublish backfill is skipped, even as a dry run.",
        how: "server",
      },
      {
        name: "ASSISTANT_CRISIS_BACKFILL_ENABLED",
        off: "The hourly crisis-flag backfill stops. It only writes flag fields and never alerts.",
        how: "server",
        note: "Set ASSISTANT_CRISIS_BACKFILL_DRY_RUN=true to count without writing.",
      },
    ],
  },
  {
    title: "Monitoring",
    blurb: "The five-minute check that posts to staff Slack.",
    items: [
      {
        name: "ASSISTANT_MONITOR_ENABLED",
        off: "All monitoring checks stop.",
        how: "server",
        note: "Each check (ledger, outbox, untaken, cost records, unpriced, feed, retention) also has its own ASSISTANT_MONITOR_<CHECK>_ENABLED.",
      },
    ],
  },
];

export const SwitchesPanel: React.FC = () => (
  <div className="aa-launch" data-testid="aa-switches">
    <Outside />
    <div className="aa-launch__lede">
      Every switch is on unless a row says otherwise.{" "}
      <Tag type="blue" size="sm">
        Database
      </Tag>{" "}
      switches flip in seconds with an UPDATE.{" "}
      <Tag type="gray" size="sm">
        Server
      </Tag>{" "}
      switches are environment settings: set them to <Code>false</Code>, <Code>0</Code> or{" "}
      <Code>off</Code>. In production that needs a task restart, so prefer the database switch where
      there is one.
    </div>
    {GROUPS.map(group => (
      <section key={group.title} aria-label={group.title}>
        <h3 className="aa-launch__h">{group.title}</h3>
        <p className="aa-launch__sub">{group.blurb}</p>
        <div className="aa-table-wrap">
          <table className="aa-table">
            <thead>
              <tr>
                <th>Switch</th>
                <th>When it is off</th>
                <th>Flip it with</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map(item => (
                <tr key={item.name}>
                  <td>
                    <Code>{item.name}</Code>
                  </td>
                  <td>
                    {item.off}
                    {item.note && <span className="aa-table__note">{item.note}</span>}
                  </td>
                  <td>
                    <Tag type={item.how === "db" ? "blue" : "gray"} size="sm">
                      {item.how === "db" ? "Database" : "Server"}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))}
    <section aria-label="Turn credit enforcement on or off">
      <h3 className="aa-launch__h">Turn credit enforcement on or off</h3>
      <p className="aa-launch__sub">
        No endpoint exists for it. Take a snapshot first. <Code>global_settings.name</Code> may not
        be unique, so use the UPDATE when the row exists. To switch off again, set both to false.
      </p>
      <Block>{`INSERT INTO global_settings (name, value, "createdBy", "updatedBy")
VALUES ('assistant_credits', '{"enforcement": true, "warningEmails": true}', 0, 0)
ON CONFLICT DO NOTHING;
UPDATE global_settings
   SET value = '{"enforcement": true, "warningEmails": true}', "updatedAt" = now()
 WHERE name = 'assistant_credits';`}</Block>
    </section>
  </div>
);

/* ---------- Launch checklist ---------- */

interface Step {
  title: string;
  body: React.ReactNode;
  check: string;
  undo: string;
}

const STEPS: Step[] = [
  {
    title: "Announce",
    body: "Tell builders and staff the date, that conversations from before the cutover lose stored memory, that live chatbots pause until their owner completes the go-live checklist, and that old messages are blanked after 90 days.",
    check: "Message sent.",
    undo: "Send a correction.",
  },
  {
    title: "Release the backend, then the dashboards",
    body: (
      <>
        Tag <Code>be-v&lt;x.y.z&gt;</Code> first; migrations run before the swap and everything
        ships dark. Then tag <Code>frontend-v&lt;x.y.z&gt;</Code> (one workflow ships both
        dashboards). Never release the dashboard before the backend. Release the backend with{" "}
        <Code>RESPONDER_AGREEMENT_ENFORCED=false</Code> and remove it once a test responder can
        accept and reply. Do it outside busy hours: a deploy drops requests for a short window.
      </>
    ),
    check: "Health is OK and every new migration id is present.",
    undo: "Roll the task definition back. Do not revert migrations in production.",
  },
  {
    title: "Take a database snapshot",
    body: "After the migrations and before any grant or irreversible step, so it holds the final schema and the old data. It contains customer messages, so delete it by the agreed date.",
    check: "Snapshot status is available.",
    undo: "Restoring means a new instance and copying rows back; a restore of the live instance loses everything written since.",
  },
  {
    title: "Grant starting credits",
    body: (
      <>
        Run the cutover grant as a dry run, read the report with a second person, then run it for
        real. It is safe to repeat. Use <Link to={go("credits")}>Builders &amp; credits</Link>.
      </>
    ),
    check: "Builders granted and budgets set match the dry run.",
    undo: "Reverse a grant with an adjustment, or restore the snapshot. Enforcement is still off, so nothing is blocked yet.",
  },
  {
    title: "Read every dry-run report",
    body: (
      <>
        All read-only: crisis backfill, retention report, Stage 5 migration, unpublish backfill,
        memory cutover, credits. Run them together with{" "}
        <Code>
          npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-cutover-dry-run.ts
        </Code>
        . A count far from what you announced stops the cutover until explained.
      </>
    ),
    check: "Counts match the announcement.",
    undo: "Nothing to undo.",
  },
  {
    title: "Switch features on, one at a time",
    body: "In order: alerts and the crisis job, monitoring, the Stage 5 migration, the crisis-flag backfill, credit enforcement, then the go-live gate. Access lists are set by owners per chatbot after release and start empty. Verify after each.",
    check: "Each feature behaves, and the monitor stays quiet.",
    undo: "Each has its own switch: see Kill switches.",
  },
  {
    title: "Verify, then the irreversible steps",
    body: (
      <>
        Only after the above. See <Link to={go("launch", "data")}>Data clean-up</Link>. Run the
        unpublish backfill last: it is the change customers see.
      </>
    ),
    check: "Snapshot confirmed, monitor quiet, second person signed off.",
    undo: "Snapshot only, for deletions.",
  },
];

export const ChecklistPanel: React.FC = () => (
  <div className="aa-launch" data-testid="aa-checklist">
    <Outside />
    <ol className="aa-steps">
      {STEPS.map((step, i) => (
        <li key={step.title} className="aa-steps__item">
          <span className="aa-steps__n" aria-hidden>
            {i + 1}
          </span>
          <div className="aa-steps__main">
            <h3 className="aa-launch__h">{step.title}</h3>
            <p className="aa-steps__body">{step.body}</p>
            <p className="aa-steps__meta">
              <strong>Check:</strong> {step.check}
            </p>
            <p className="aa-steps__meta">
              <strong>If it goes wrong:</strong> {step.undo}
            </p>
          </div>
        </li>
      ))}
    </ol>
  </div>
);

/* ---------- Data clean-up ---------- */

interface Job {
  title: string;
  what: string;
  run: string;
  kind: "safe" | "visible" | "final";
  needs?: string;
}

const JOBS: Job[] = [
  {
    title: "Retention report",
    what: "Counts per store of what the sweep would erase, and why a real run is blocked.",
    run: "GET /v1/staff/retention/report",
    kind: "safe",
  },
  {
    title: "Crisis-flag backfill",
    what: "Hourly job that flags old conversations. Must finish before the retention sweep can run.",
    run: "ASSISTANT_CRISIS_BACKFILL_DRY_RUN=true to count only",
    kind: "safe",
  },
  {
    title: "Unpublish backfill",
    what: "Pauses live chatbots that fail the go-live gate. Not destructive: each owner goes live again through the gate.",
    run: "POST /v1/staff/assistants/unpublish-backfill   (dry run is the default; ?dryRun=false to apply)",
    kind: "visible",
    needs: "Run last: it is the change customers see.",
  },
  {
    title: "Delete memory stored before consent",
    what: "Deletes stored memory (D7). A second run deletes nothing.",
    run: 'POST /v1/staff/memory-cutover   {"dryRun": true}  then  {"dryRun": false}',
    kind: "final",
    needs: "Counts equal the last dry run. Restore is snapshot only.",
  },
  {
    title: "Retention sweep",
    what: "Blanks message content older than each chatbot's retention (default 90 days). Flagged conversations are kept 12 months.",
    run: "npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-retention-report.ts --apply",
    kind: "final",
    needs:
      "Crisis backfill done, snapshot taken. Restore is snapshot only: keep it until the delete-by date.",
  },
];

const TAGS: Record<Job["kind"], { type: "green" | "red" | "warm-gray"; label: string }> = {
  safe: { type: "green", label: "Safe to repeat" },
  visible: { type: "warm-gray", label: "Customers see it" },
  final: { type: "red", label: "Cannot be undone" },
};

export const DataPanel: React.FC = () => (
  <div className="aa-launch" data-testid="aa-data">
    <Outside />
    <InlineNotification
      kind="warning"
      lowContrast
      hideCloseButton
      title="Before any step marked Cannot be undone or Customers see it:"
      subtitle="repeat its dry run within the last hour, check the monitor is quiet, confirm the snapshot is available, and get a second person's sign-off written down."
    />
    <div className="aa-jobs">
      {JOBS.map(job => (
        <Tile key={job.title} className="aa-job">
          <div className="aa-job__top">
            <h3 className="aa-launch__h">{job.title}</h3>
            <Tag type={TAGS[job.kind].type} size="sm">
              {TAGS[job.kind].label}
            </Tag>
          </div>
          <p className="aa-job__what">{job.what}</p>
          <Block>{job.run}</Block>
          {job.needs && <p className="aa-job__needs">{job.needs}</p>}
        </Tile>
      ))}
    </div>
  </div>
);
