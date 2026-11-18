-- Q3-fast Part 2: export the real assistants' knowledge from production, READ-ONLY.
--
-- What it exports, per chatbot id given:
--   * the assistant's settings: name, purpose, safety pack, rules, persona, model, overrides;
--   * the text of every knowledge document it answers from (site pages, uploads, "Owner notes");
--   * the site reader's facts and the owner's setup answers (bot_drafts.learned / answers /
--     draft_config), never the setup chat's transcript or events;
--   * each list's definition, fields and rules, and only the entries nobody made for a person:
--     records with no contact (products, slots, tables, listings, an order the owner added);
--   * the checkup's questions (generated or written by the owner, with the facts a good answer
--     includes) and the latest finished checkup's results: the assistant's replies to those
--     questions and the grader's reasons (Q3-fast Part 3, the grader's false fails, B9).
-- What it never exports: conversations, messages, contacts, memory, or any entry tied to a
-- person (reservations, appointments, leads, callback requests made by visitors).
--
-- Also exports the live Skills Store text of the agent and knowledge prompts, so the local
-- diagnosis runs with production's prompts.
--
-- Run (from a machine with production read access):
--   psql "$PROD_READONLY_URL" -X -At -v ids="'<id1>','<id2>',…" \
--        -f ally-be/scripts/q3/export-assistants.sql > ~/ally-exports/q3-fast/assistants.jsonl
--
-- To find the ids first:
--   psql "$PROD_READONLY_URL" -X -At -c "select id, name, status, created_at::date from chatbots
--     where archived_at is null and name ~* '(souled|cloudnine|scripbox|mpower|indian ?accent|honer|neemrana)'
--     order by name"

BEGIN TRANSACTION READ ONLY;

SELECT json_build_object(
  'kind', 'assistant',
  'chatbot', json_build_object(
    'id', c.id, 'name', c.name, 'description', c.description, 'status', c.status,
    'access_mode', c.access_mode, 'answer_mode', c.answer_mode,
    'knowledge_source', c.knowledge_source, 'persona', c.persona, 'model', c.model,
    'settings', c.settings, 'safety_pack', c.safety_pack,
    'safety_pack_version', c.safety_pack_version, 'rules', c.rules,
    'purpose', c.purpose, 'purpose_note', c.purpose_note
  ),
  'documents', COALESCE((
    SELECT json_agg(json_build_object(
      'id', d.id, 'title', d.title, 'source_type', d.source_type,
      'source_url', d.source_url, 'file_name', d.file_name, 'language', d.language,
      'tags', d.tags, 'status', d.status, 'corpus', d.corpus, 'raw_text', d.raw_text
    ) ORDER BY d.title)
    FROM chatbot_documents cd
    JOIN kb_documents d ON d.id = cd.document_id AND d.archived_at IS NULL
    WHERE cd.chatbot_id = c.id
  ), '[]'::json),
  'draft', (
    SELECT json_build_object(
      'industry', b.industry, 'safety_pack', b.safety_pack, 'source', b.source,
      'learned', b.learned, 'answers', b.answers, 'draft_config', b.draft_config
    )
    FROM bot_drafts b WHERE b.chatbot_id = c.id
    ORDER BY b."updatedAt" DESC LIMIT 1
  ),
  'lists', COALESCE((
    SELECT json_agg(json_build_object(
      'key', l.key, 'name', l.name, 'settings', l.settings,
      'agent_read', l.agent_read, 'agent_write', l.agent_write,
      'fields', (SELECT json_agg(json_build_object(
          'key', f.key, 'label', f.label, 'type', f.type, 'options', f.options,
          'required', f.required, 'default', f.default, 'privacy', f.privacy,
          'agent_read', f.agent_read, 'agent_write', f.agent_write, 'position', f.position)
        ORDER BY f.position) FROM collection_fields f
        WHERE f.collection_id = l.id AND f.archived_at IS NULL),
      'rules', (SELECT json_agg(json_build_object('kind', k.kind, 'config', k.config))
        FROM collection_constraints k WHERE k.collection_id = l.id),
      'records', (SELECT json_agg(json_build_object('id', r.id, 'data', r.data)
          ORDER BY r."createdAt") FROM collection_records r
        WHERE r.collection_id = l.id AND r.deleted_at IS NULL AND r.contact_id IS NULL)
    ) ORDER BY l.key)
    FROM collections l WHERE l.chatbot_id = c.id AND l.deleted_at IS NULL
  ), '[]'::json),
  'checkup_cases', COALESCE((
    SELECT json_agg(json_build_object(
      'id', k.id, 'question', k.question, 'expect', k.expect, 'facts', k.facts,
      'must_not', k.must_not, 'also_ok', k.also_ok, 'source', k.source, 'origin', k.origin,
      'tier', k.tier, 'hard_fail', k.hard_fail, 'pack_id', k.pack_id, 'status', k.status
    ) ORDER BY k.question)
    FROM chatbot_checkup_cases k
    WHERE k.chatbot_id = c.id AND k.deleted_at IS NULL AND k.suite IS NULL
  ), '[]'::json),
  'checkup_latest', (
    SELECT json_build_object(
      'run_id', run.id, 'finished_at', run.finished_at, 'totals', run.totals,
      'results', (SELECT json_agg(json_build_object(
          'case_id', r.case_id, 'attempt', r.attempt, 'reply', r.reply,
          'outcome', r.outcome, 'verdict', r.verdict, 'reasons', r.reasons,
          'citations', r.citations, 'grader_version', r.grader_version)
        ORDER BY r."createdAt") FROM chatbot_checkup_results r WHERE r.run_id = run.id)
    )
    FROM chatbot_checkup_runs run
    WHERE run.chatbot_id = c.id AND run.status = 'done' AND run.suite IS NULL
    ORDER BY run.started_at DESC LIMIT 1
  )
)
FROM chatbots c
WHERE c.id::text IN (:ids);

SELECT json_build_object(
  'kind', 'prompts',
  'prompts', json_agg(json_build_object(
    'code', p."promptCode", 'version', p."currentVersion", 'prompt', v.prompt,
    'provider', v.provider, 'model', v.model, 'temperature', v.temperature
  ) ORDER BY p."promptCode")
)
FROM prompts p
JOIN prompts_versions v ON v."promptId" = p.id AND v.version = p."currentVersion"
WHERE p."promptCode" LIKE 'ally_ai_agent_%' OR p."promptCode" LIKE 'ally_ai_knowledge_%'
   OR p."promptCode" LIKE 'ally_ai_checkup_%';

ROLLBACK;
