import { LanguageJudgeRepository } from '../language-judge.repository';
import { mainPromptCodeSql } from '../../util/main-prompt-version.util';

/**
 * Which main-agent prompt version a language judgment is stamped with.
 *
 * Since the Skills Store ships every prompt to a session, the session record
 * holds every main-agent variant. The judge used to take the first key
 * containing `main_agent`, which made every session the default prompt's
 * version; it now uses the shared rule the drift and filler judges use.
 */
describe('language judge prompt-version stamp', () => {
  const persistWith = async (selected: string | null) => {
    const query = jest.fn().mockResolvedValue([{ id: 'j1' }]);
    const dataSource = {
      transaction: jest.fn(async (work: (em: unknown) => unknown) =>
        work({ query }),
      ),
    };
    await new LanguageJudgeRepository(dataSource as never).persistJudgment(
      {
        id: 's1',
        tenant_id: 't1',
        prompt_versions: {
          ally_ai_learn_system_main_agent_prompt: 17,
          ally_ai_learn_system_main_agent_prompt_full: 9,
          ally_ai_learn_system_main_agent_prompt_working_memory_split: 41,
        },
        selected_main_prompt_code: selected,
      } as never,
      { per_turn: [], turns_judged: 3, dropped_annotations: 0 } as never,
      'judge-model',
      'judge-v1',
      {},
      {},
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('"promptVersion"');
    return params[11];
  };

  it('stamps the version of the prompt the session selected', async () => {
    expect(
      await persistWith(
        'ally_ai_learn_system_main_agent_prompt_working_memory_split',
      ),
    ).toBe('41');
  });

  it('stamps the default prompt when none was selected', async () => {
    expect(await persistWith(null)).toBe('17');
  });
});

describe('main prompt code in SQL', () => {
  it('takes the selected or default prompt before any guess by name', () => {
    const sql = mainPromptCodeSql('s');
    const ran = `COALESCE(NULLIF(s.metadata->>'selectedMainPromptCode', ''), 'ally_ai_learn_system_main_agent_prompt')`;
    expect(sql).toContain(`s.metadata->'promptVersions' ? ${ran} THEN ${ran}`);
    expect(sql.indexOf(`? ${ran}`)).toBeLessThan(
      sql.indexOf("LIKE '%main_agent%'"),
    );
  });
});
