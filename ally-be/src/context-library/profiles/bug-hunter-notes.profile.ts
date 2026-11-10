import { ClChunkOrigin, ClCollectionId } from '../enum/context-library.enum';
import { CollectionProfile, ProfileChunkView } from './profile.types';
import { joinList } from './profile.util';

/**
 * A note is one line written for a stranger — name the repo, file, command or symptom —
 * not a document. The cap Bug Hunter's notes always had.
 */
export const BUG_HUNTER_NOTE_MAX_CHARS = 600;

/**
 * Bug Hunter's memory: short notes its sweeps, fix sessions and verifiers wrote for their
 * future runs (a flaky suite, a fix gotcha, a wrong fix and where its chain broke), plus notes
 * people add in the Library. Tags stay open so kinds of note can emerge rather than being fixed
 * up front. Replaces `agent_memories` (agent `bug_hunter`) and the agent-memory module.
 */
export const BUG_HUNTER_NOTES_PROFILE: CollectionProfile = {
  id: ClCollectionId.BUG_HUNTER_NOTES,
  name: 'Bug Hunter Notes',
  purpose:
    'Short notes Ally’s Bug Hunter agent wrote for its future runs about finding, verifying and ' +
    'fixing bugs in Ally’s repos: flaky suites, fix gotchas, wrong fixes and where they broke, ' +
    'features that are easy to misread. Its readers are Bug Hunter’s sweeps, fix sessions and ' +
    'verifiers, and engineers’ coding agents. A note is relevant when it would change what the ' +
    'agent does about the bug or code the query describes; one about the same repo that would ' +
    'not change that is tangential.',
  noun: 'note',
  nounPlural: 'notes',
  codePrefix: 'BN',
  allowedOrigins: [ClChunkOrigin.AGENT, ClChunkOrigin.AUTHORED],
  allowsOrgChunks: false,
  neverGrantTo: [],
  statementMaxChars: BUG_HUNTER_NOTE_MAX_CHARS,
  facets: {
    tags: { label: 'Tags', multi: true },
    repos: { label: 'Repos', multi: true },
  },
  attributes: {
    // Provenance: the runs whose reflection wrote (or agreed with) this note, and the findings
    // it was learned from.
    runIds: { label: 'Runs', type: 'text[]', shown: false },
    findingIds: { label: 'Findings', type: 'text[]', shown: false },
  },
  densityCap: { perSegment: 0, min: 0, max: 80 },
  agentCuration: {
    agents: ['bug_hunter'],
    // The agent-memory curator's numbers, carried over.
    activeCap: 80,
    candidateTrigger: 5,
    maxActiveChangesPerPass: 10,
  },
  retrievalDefaults: {
    weights: { bm25: 1, statement: 1, situations: 1 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  statementText: (c: ProfileChunkView) => c.statement,
  situationsText: (c: ProfileChunkView) =>
    [
      joinList(c.facets?.repos as string[] | undefined),
      joinList(c.facets?.tags as string[] | undefined),
      joinList(c.situations),
      joinList(c.exampleQueries),
    ]
      .filter(Boolean)
      .join(' · '),
  card: (c: ProfileChunkView, band?: string) => {
    const repos = Array.isArray(c.facets?.repos)
      ? (c.facets.repos as string[]).join('/')
      : 'platform';
    const tags = Array.isArray(c.facets?.tags)
      ? (c.facets.tags as string[]).join(', ')
      : '';
    const head = [c.code, repos, tags, band ?? ''].filter(Boolean).join(' · ');
    return `[${head}] ${c.statement}${c.body ? `\n  ${c.body}` : ''}`;
  },
};
