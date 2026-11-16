-- Bug Hunter v2 (chunk 09): what ally-be's limited role may do in the bughunter
-- database. Infra creates the role (bughunter_dashboard) with its own password; this
-- migration only grants, and is a no-op where the role does not exist (local dev).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bughunter_dashboard') THEN
    GRANT USAGE ON SCHEMA bughunter TO bughunter_dashboard;
    GRANT SELECT ON bughunter.reports TO bughunter_dashboard;
    GRANT SELECT, INSERT ON bughunter.verdicts TO bughunter_dashboard;
    GRANT UPDATE (superseded_by, superseded_at) ON bughunter.verdicts TO bughunter_dashboard;
    GRANT USAGE ON SEQUENCE bughunter.verdicts_id_seq TO bughunter_dashboard;
    GRANT SELECT ON bughunter.approvals TO bughunter_dashboard;
    GRANT UPDATE (status, decided_by, decided_at, reason) ON bughunter.approvals TO bughunter_dashboard;
  END IF;
END $$;
