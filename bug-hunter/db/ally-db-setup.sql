-- One-time setup of Bug Hunter v2 inside ally-be's database (spec §15).
--
-- Run once per environment as the database owner or a superuser, connected to ally-be's
-- database (locally: `make ally-db-setup`). Idempotent. It creates no password: infra
-- sets one afterwards (`ALTER ROLE bughunter PASSWORD '…'`); locally the Makefile sets
-- the dev password `bughunter`.
--
-- The isolation this gives (tested by tests/integration/test_ally_db_isolation.py):
--   * the agent's role `bughunter` owns the `bughunter` schema and nothing else;
--   * it receives no grant on ally-be's tables, so it cannot read users, sessions or
--     any other PHI table (ally-be grants nothing to PUBLIC);
--   * its search_path is pinned to `bughunter`, and the code pins it again on every
--     connection (graph/checkpointer.py `connect`), so LangGraph's setup() can never
--     create tables in ally-be's `public` schema.
--
-- ally-be reads the schema with its own login through the NOLOGIN group role
-- `bughunter_dashboard` (grants in migrations/0007_dashboard_role_grants.sql). Infra
-- adds ally-be's login role to it: GRANT bughunter_dashboard TO <ally-be's role>;
-- A superuser (the local `postgres`) needs no membership.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bughunter') THEN
    CREATE ROLE bughunter LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bughunter_dashboard') THEN
    CREATE ROLE bughunter_dashboard NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS bughunter AUTHORIZATION bughunter;
ALTER SCHEMA bughunter OWNER TO bughunter;
ALTER ROLE bughunter SET search_path = bughunter;

-- Nothing on ally-be's own schema beyond what every role gets from PUBLIC.
REVOKE ALL ON SCHEMA public FROM bughunter;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM bughunter;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM bughunter;

-- Tables the agent creates later are readable by the dashboard role only through the
-- explicit grants in 0007; nothing by default.
ALTER DEFAULT PRIVILEGES FOR ROLE bughunter IN SCHEMA bughunter REVOKE ALL ON TABLES FROM PUBLIC;
