import { Effect } from 'effect';

import type { Asset, Diagnostic, Workspace } from './model.ts';
import type { Source } from './source.ts';

import { resolveAvatars } from './avatars.ts';
import { ContentError } from './errors.ts';
import { errorText } from './run.ts';
import { schemaFor } from './schemas.ts';
import { addDiagnostic, fileExists, fileStart, readSource } from './source.ts';

/**
 * Settings filename at the root of a roadmap workspace.
 */
const WORKSPACE_FILE = 'roadmap.yaml';

/**
 * Characters excluded from an authored Jira base URL.
 */
const URL_UNSAFE_CHARACTERS = /[\p{Cc} \\]/u;

/**
 * Matches trailing slashes stripped from the Jira instance path.
 */
const TRAILING_SLASHES = /\/+$/;

/**
 * Directory kinds resolved independently from inline or external definitions.
 */
type RegistryKind = 'people' | 'teams';

/**
 * Settings accepted by the runtime workspace schema.
 */
type WorkspaceConfig = ReturnType<typeof schemaFor<'workspace'>>['Type'];

/**
 * Common name-bearing shape of a team or person entry.
 */
type RegistryEntry = string | { name: string };

/**
 * Registry data plus the file and field locator needed for diagnostics.
 */
type RegistrySource<T> = Pick<Source<T>, 'data' | 'field' | 'file'>;

/**
 * Resolved workspace settings and the files that supply each registry.
 */
export type WorkspaceSource = {
  /**
   * Decoded settings, normalized Jira URL and resolved registry entries.
   */
  workspace: Workspace;

  /**
   * Fingerprinted thumbnails referenced by the normalized person profiles.
   */
  avatars: Array<Asset>;

  /**
   * Source filename for each resolved directory.
   */
  registryFiles: Record<RegistryKind, string>;
};

/**
 * Reads the required settings and resolves the source of each registry.
 *
 * @param root Workspace directory containing the settings and optional registry files.
 * @param diagnostics Receives decoding, URL and cross-registry errors.
 * @returns The resolved workspace, or undefined if the settings or either registry cannot be read
 *   unambiguously.
 */
export const readWorkspace = Effect.fnUntraced(function* (
  root: string,
  diagnostics: Array<Diagnostic>,
): Effect.fn.Return<WorkspaceSource | undefined, ContentError> {
  const options = { diagnostics, frontMatter: false };
  const source = yield* readSource(root, WORKSPACE_FILE, schemaFor('workspace'), options);
  if (source === undefined) {
    return undefined;
  }

  const people = yield* readRegistry(root, source, 'people', diagnostics);
  const teams = yield* readRegistry(root, source, 'teams', diagnostics);
  const jiraUrl = readJiraBase(source, diagnostics);
  if (people === undefined || teams === undefined) {
    return undefined;
  }

  const workspace: Workspace = {
    schema_version: source.data.schema_version,
    title: source.data.title,
    people: registryNames(people.data),
    teams: registryNames(teams.data),
  };
  const personDetails = registryDetails(people.data);
  const teamDetails = registryDetails(teams.data);
  if (Object.keys(personDetails).length > 0) {
    workspace.person_details = personDetails;
    validateMemberships(personDetails, people.field, workspace.teams, {
      teamsFile: teams.file,
      diagnostics,
    });
  }

  if (Object.keys(teamDetails).length > 0) {
    workspace.team_details = teamDetails;
  }

  if (jiraUrl !== undefined) {
    workspace.jira_base_url = jiraUrl;
  }

  const avatars = yield* Effect.tryPromise({
    try: () => resolveAvatars(root, personDetails, people.field, diagnostics),
    catch: (cause) => new ContentError({ message: errorText(cause) }),
  });
  return { workspace, avatars, registryFiles: { people: people.file, teams: teams.file } };
});

/**
 * Yields the first occurrence of each registry ID and reports repeats at their authored entries.
 *
 * @param ids The list of registry references as written.
 * @param path The YAML path to the list.
 * @param field Locates a YAML path in the original source.
 * @param diagnostics Receives errors for each repeated entry.
 * @yields The original index and ID for each distinct reference, in source order.
 */
export function* uniqueRegistryIds(
  ids: ReadonlyArray<string>,
  path: ReadonlyArray<PropertyKey>,
  field: Source<unknown>['field'],
  diagnostics: Array<Diagnostic>,
): Generator<[number, string]> {
  const firstById = new Map<string, number>();
  for (const [index, id] of ids.entries()) {
    const first = firstById.get(id);
    if (first !== undefined) {
      addDiagnostic(diagnostics, field([...path, index]), {
        severity: 'error',
        rule: 'duplicate-registry-reference',
        message: `"${id}" is already listed here.`,
        fix: 'Remove the repeated entry.',
        related: [field([...path, first])],
      });
      continue;
    }

    firstById.set(id, index);
    yield [index, id];
  }
}

/**
 * Selects an inline or external registry and rejects missing or competing declarations.
 */
const readRegistry = Effect.fnUntraced(function* <Kind extends RegistryKind>(
  root: string,
  workspace: Source<WorkspaceConfig>,
  kind: Kind,
  diagnostics: Array<Diagnostic>,
): Effect.fn.Return<RegistrySource<ReturnType<typeof schemaFor<Kind>>['Type']> | undefined> {
  const file = `${kind}.yaml`;
  const inline = workspace.data[kind];
  if (yield* Effect.promise(() => fileExists(root, file))) {
    if (inline !== undefined) {
      addDiagnostic(diagnostics, workspace.field([kind]), {
        severity: 'error',
        rule: 'duplicate-registry',
        message: `The ${kind} registry is declared in both ${WORKSPACE_FILE} and ${file}.`,
        fix: `Keep a single ${kind} registry in ${file} or ${WORKSPACE_FILE}.`,
        related: [fileStart(file)],
      });
      return undefined;
    }

    return yield* readSource(root, file, schemaFor(kind), { diagnostics, frontMatter: false });
  }

  if (inline === undefined) {
    addDiagnostic(diagnostics, workspace.field([kind]), {
      severity: 'error',
      rule: 'missing-registry',
      message: `The workspace needs a ${kind} registry.`,
      fix: `Add ${kind} to ${WORKSPACE_FILE} or create ${file}. Use {} for an empty registry.`,
    });
    return undefined;
  }

  return { data: inline, field: (path) => workspace.field([kind, ...path]), file: workspace.file };
});

/**
 * Resolves string and structured entries into a shared ID-to-display-name lookup.
 */
function registryNames(registry: Record<string, RegistryEntry>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(registry).map(([id, entry]) => [
      id,
      typeof entry === 'string' ? entry : entry.name,
    ]),
  );
}

/**
 * Extracts metadata from object entries. Names already belong to the ID-to-name lookup.
 */
function registryDetails<Entry extends RegistryEntry>(
  registry: Record<string, Entry>,
): Record<string, Omit<Exclude<Entry, string>, 'name'>> {
  const entries = Object.entries(registry).filter(
    (entry): entry is [string, Exclude<Entry, string>] => typeof entry[1] !== 'string',
  );
  return Object.fromEntries(entries.map(([id, { name: _name, ...details }]) => [id, details]));
}

/**
 * Checks each person's team IDs against the resolved team registry.
 */
function validateMemberships(
  people: NonNullable<Workspace['person_details']>,
  field: Source<unknown>['field'],
  teams: Workspace['teams'],
  { teamsFile, diagnostics }: { teamsFile: string; diagnostics: Array<Diagnostic> },
): void {
  for (const [person, { teams: memberships = [] }] of Object.entries(people)) {
    const path = [person, 'teams'];
    for (const [index, team] of uniqueRegistryIds(memberships, path, field, diagnostics)) {
      if (!Object.hasOwn(teams, team)) {
        addDiagnostic(diagnostics, field([...path, index]), {
          severity: 'error',
          rule: 'unknown-team',
          message: `"${team}" is missing from the teams registry in ${teamsFile}.`,
          fix: `Use a registered team ID or add "${team}" to the registry in ${teamsFile}.`,
        });
      }
    }
  }
}

/**
 * Validates and normalizes the optional Jira instance address.
 */
function readJiraBase(
  source: Source<WorkspaceConfig>,
  diagnostics: Array<Diagnostic>,
): string | undefined {
  const jiraUrl = source.data.jira_base_url;
  if (jiraUrl === undefined) {
    return undefined;
  }

  const url = URL.parse(jiraUrl);
  if (url === null || URL_UNSAFE_CHARACTERS.test(jiraUrl) || !validJiraBase(url, jiraUrl)) {
    addDiagnostic(diagnostics, source.field(['jira_base_url']), {
      severity: 'error',
      rule: 'invalid-jira-base-url',
      message: 'jira_base_url needs an HTTPS URL without credentials, query or fragment.',
      fix: 'Use the base URL of your Jira instance, such as https://example.atlassian.net.',
    });
    return undefined;
  }

  return url.origin + url.pathname.replace(TRAILING_SLASHES, '');
}

/**
 * Checks the complete URL before allowing it to prefix outbound issue links.
 */
function validJiraBase(url: URL, written: string): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return false;
  }

  return !written.includes('?') && !written.includes('#');
}
