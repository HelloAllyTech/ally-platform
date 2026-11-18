import {
  AGENT_ACCESS,
  DATA_ITEMS,
  PM_AGENT_ACCESS,
} from '../constants/debrief-data-access.constants';
import { ROLEPLAY_FIELDS } from '../constants/debrief-roleplay-fields.constants';
import { enabledRoleplayKeys } from './debrief-roleplay-brief.util';

/**
 * Settings › Agents › "What each agent can read": the declared data access (a mirror of the real
 * wiring, checked by tests), the Debrief PM agent's tools, and the optional roleplay fields with
 * whether the live release has each on.
 */
export function dataAccessView(roleplayFieldsSetting: unknown) {
  const on = new Set(enabledRoleplayKeys(roleplayFieldsSetting));
  return {
    data: DATA_ITEMS,
    agents: AGENT_ACCESS.map((a) => {
      const byData = new Map<
        string,
        { keys: string[]; conditional: string[] }
      >();
      for (const [key, item] of Object.entries(a.body)) {
        if (!item) continue;
        const row = byData.get(item) ?? { keys: [], conditional: [] };
        row.keys.push(key);
        if (a.when?.[key]) row.conditional.push(a.when[key]);
        byData.set(item, row);
      }
      return {
        key: a.key,
        label: a.label,
        reads: [...byData].map(([data, r]) => ({
          data,
          // Only when every key it arrives in is conditional.
          when:
            r.conditional.length === r.keys.length
              ? [...new Set(r.conditional)][0]
              : null,
        })),
      };
    }),
    pmAgent: PM_AGENT_ACCESS,
    roleplayFields: ROLEPLAY_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      alwaysOn: !!f.alwaysOn,
      defaultOn: !!f.defaultOn,
      enabled: !!f.alwaysOn || on.has(f.key),
    })),
  };
}
