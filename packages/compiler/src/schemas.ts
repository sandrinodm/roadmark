import type { JsonSchema } from 'effect';

import { Schema } from 'effect';

import { brandSchema, stillImagePath } from './brand-schema.ts';
import { DAY_PATTERN, TARGET_PATTERN } from './dates.ts';

/**
 * Slugs accepted for entity and registry IDs.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$(?!\s)/u;

/**
 * Requires at least one character other than whitespace.
 */
const NONBLANK_PATTERN = /\S/u;

/**
 * Accepts project-prefixed issue keys for search and browse links.
 */
const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]*-[1-9]\d*$(?!\s)/u;

/**
 * First-pass scheme check for a Jira base URL.
 */
const HTTPS_URL_PATTERN = /^https:\/\//u;

/**
 * Nonblank text displayed to readers.
 */
const text = patternedString(NONBLANK_PATTERN, 'nonblank text');

/**
 * Lowercase stable ID accepted in metadata and routes.
 */
const slug = patternedString(SLUG_PATTERN, 'a lowercase slug with digits and single hyphens');

/**
 * Syntax schema for a single YYYY-MM-DD day.
 */
const day = patternedString(DAY_PATTERN, 'a calendar date in YYYY-MM-DD format');

/**
 * Syntax schema for a day, month or quarter. The graph checks calendar validity.
 */
const target = patternedString(TARGET_PATTERN, 'a target in YYYY-MM-DD, YYYY-MM or YYYY-Q1 format');

/**
 * Inline registry mapping stable IDs to display names.
 */
const peopleOrTeams = Schema.Record(slug, text);

/**
 * Person ID syntax, documented with its registry.
 */
const personId = slug.annotate({ description: 'Person ID from the people registry.' });

/**
 * Team ID syntax, documented with its registry.
 */
const teamId = slug.annotate({ description: 'Team ID from the teams registry.' });

/**
 * Stable slug for a release reference. The graph checks that the release exists.
 */
const releaseId = slug.annotate({ description: 'Stable ID of the release.' });

/**
 * Intended customer or business result against which readers can assess the work.
 */
const outcome = text.annotate({ description: 'The result the work is intended to achieve.' });

/**
 * One prerequisite item with an optional reason.
 */
const itemDependency = Schema.Struct({
  /**
   * Stable ID of the prerequisite roadmap item.
   */
  item: slug.annotate({ description: 'Stable ID of the prerequisite item.' }),

  /**
   * Optional context explaining why the prerequisite is needed.
   */
  reason: Schema.optionalKey(text.annotate({ description: 'Why this work depends on the item.' })),
});

/**
 * Issue keys to include in the search index and link to Jira.
 */
const jira = Schema.optionalKey(
  Schema.Array(patternedString(JIRA_KEY_PATTERN, 'a Jira issue key such as ROAD-123')),
);

/**
 * Requires a web scheme and an authority, and rejects whitespace, controls and backslashes.
 */
const RESOURCE_URL_PATTERN = /^[Hh][Tt][Tt][Pp][Ss]?:\/\/[^/?#\s\p{Cc}\\][^\s\p{Cc}\\]*$(?!\s)/u;

/**
 * Named web resources attached directly to a feature set or item.
 */
const links = Schema.optionalKey(
  Schema.Array(
    Schema.Struct({
      /**
       * Reader-facing label for the linked resource.
       */
      label: text.annotate({ description: 'Reader-facing name for the destination.' }),

      /**
       * Absolute HTTP or HTTPS destination without embedded credentials.
       */
      url: Schema.String.check(
        Schema.isPattern(RESOURCE_URL_PATTERN, {
          expected: 'an absolute HTTP or HTTPS URL',
        }).abort(),
        Schema.makeFilter(isCredentialFreeUrl, {
          expected: 'a valid web URL without embedded credentials',
        }),
      ).annotate({ description: 'An absolute HTTP or HTTPS URL without embedded credentials.' }),
    }),
  ).annotate({ description: 'Ordered list of named web links, each with a label and URL.' }),
);

/**
 * Checks that the address parses and can be published without embedding login credentials.
 *
 * @param value Web address supplied in a links entry.
 * @returns Whether the address parses without a username or password.
 */
function isCredentialFreeUrl(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && url.username === '' && url.password === '';
}

/**
 * Identity and summary fields shared by every roadmap document.
 */
const entityFields = {
  /**
   * Stable workspace identifier used in references and generated routes.
   */
  id: slug.annotate({
    description: 'Stable ID that is independent of the file or directory name.',
  }),

  /**
   * Human-readable name used as a page or workspace heading.
   */
  title: text,

  /**
   * Summary shown in lists and search results.
   */
  description: text,
};

/**
 * Optional overrides for values inherited by a roadmap item.
 */
const ownershipFields = {
  /**
   * Optional product manager ID for an item-level ownership override.
   */
  pm: Schema.optionalKey(personId),

  /**
   * Optional team ID for an item-level ownership override.
   */
  engineering_team: Schema.optionalKey(teamId),
};

/**
 * Named team with optional descriptive context on its profile.
 */
const teamEntry = Schema.Struct({
  /**
   * Display name used for this team throughout the roadmap.
   */
  name: text,

  /**
   * Optional context shown on the team’s profile.
   */
  description: Schema.optionalKey(text),
});

/**
 * Named person with optional role and team memberships.
 */
const personEntry = Schema.Struct({
  /**
   * Display name used for this person throughout the roadmap.
   */
  name: text,

  /**
   * Workspace-relative path to a still image used as a portrait.
   */
  avatar: Schema.optionalKey(
    stillImagePath.annotate({ description: 'Workspace-relative PNG, JPEG or WebP portrait.' }),
  ),

  /**
   * Optional role shown on the person’s profile.
   */
  role: Schema.optionalKey(text),

  /**
   * IDs of registered teams this person belongs to.
   */
  teams: Schema.optionalKey(Schema.mutable(Schema.Array(teamId))),
});

/**
 * External teams file mapping stable IDs to names or team profiles.
 */
const teams = Schema.Record(slug, Schema.Union([text, teamEntry]));

/**
 * External people file mapping stable IDs to names or person profiles.
 */
const people = Schema.Record(slug, Schema.Union([text, personEntry]));

/**
 * Root roadmap settings with optional inline registries.
 */
const workspace = Schema.Struct({
  /**
   * Workspace configuration format version understood by the compiler.
   */
  schema_version: Schema.Literal(1),

  /**
   * Display title used in workspace headings and navigation.
   */
  title: text,

  /**
   * Inline person registry keyed by stable IDs.
   */
  people: Schema.optionalKey(people),

  /**
   * Inline team names keyed by stable IDs.
   */
  teams: Schema.optionalKey(peopleOrTeams),

  /**
   * HTTPS base address used to build Jira issue links.
   */
  jira_base_url: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(HTTPS_URL_PATTERN)).annotate({
      description: 'HTTPS base URL before /browse/ISSUE-KEY.',
    }),
  ),
});

/**
 * Feature-set frontmatter, including the owners inherited by its items.
 */
const set = Schema.Struct({
  ...entityFields,

  /**
   * Ordered resources associated with the feature set.
   */
  links,

  /**
   * Customer or business result the feature set is intended to achieve.
   */
  outcome,

  /**
   * Product manager ID inherited by items unless they override it.
   */
  pm: personId,

  /**
   * Engineering team ID inherited by items unless they override it.
   */
  engineering_team: teamId,
});

/**
 * Item frontmatter, including delivery targets, ownership overrides and dependencies.
 */
const item = Schema.Struct({
  ...entityFields,

  /**
   * Ordered resources associated with this item.
   */
  links,

  /**
   * Customer or business result this item is intended to achieve.
   */
  outcome,

  /**
   * Delivery state used to track progress on the item.
   */
  status: Schema.Literals(['proposed', 'planned', 'in-progress', 'done', 'cancelled']),

  /**
   * Optional ID of the release containing this item.
   */
  release: Schema.optionalKey(releaseId),

  /**
   * Optional calendar day when work is scheduled to begin.
   */
  start: Schema.optionalKey(day),

  /**
   * Optional delivery target expressed as a day, month or quarter.
   */
  target: Schema.optionalKey(target),
  ...ownershipFields,

  /**
   * Person IDs to credit for contributing to this item.
   */
  contributors: Schema.optionalKey(Schema.mutable(Schema.Array(personId))),

  /**
   * Team IDs to credit for contributing to this item.
   */
  contributing_teams: Schema.optionalKey(Schema.Array(teamId)),

  /**
   * Prerequisite items with optional reasons for each dependency.
   */
  depends_on: Schema.optionalKey(Schema.Array(itemDependency)),

  /**
   * Issue keys indexed for search and used to build Jira links.
   */
  jira,
});

/**
 * Release frontmatter, including the target window and optional actual delivery date.
 */
const release = Schema.Struct({
  ...entityFields,

  /**
   * Customer or business result this release is intended to achieve.
   */
  outcome,

  /**
   * Delivery state used to track the release.
   */
  status: Schema.Literals(['planned', 'in-progress', 'shipped', 'cancelled']),

  /**
   * Optional calendar day when release work begins.
   */
  start: Schema.optionalKey(day),

  /**
   * Required delivery target expressed as a day, month or quarter.
   */
  target,

  /**
   * Actual delivery day required for a shipped release.
   */
  shipped_on: Schema.optionalKey(
    day.annotate({ description: 'Actual ship date, required when status is shipped.' }),
  ),
});

/**
 * Lookup shared by runtime decoding, editor integration and generated documentation.
 */
const schemasByKind = {
  /**
   * Root roadmap settings.
   */
  workspace,

  /**
   * Feature-set README metadata.
   */
  set,

  /**
   * Item metadata.
   */
  item,

  /**
   * Release metadata.
   */
  release,

  /**
   * External team registry.
   */
  teams,

  /**
   * External people registry.
   */
  people,

  /**
   * Optional workspace brand configuration.
   */
  brand: brandSchema,
};

/**
 * Selects a runtime schema for a configuration, registry or document frontmatter file.
 */
export function schemaFor<Kind extends keyof typeof schemasByKind>(
  kind: Kind,
): (typeof schemasByKind)[Kind] {
  return schemasByKind[kind];
}

/**
 * Generates standalone JSON Schema documents from the same field definitions as lint.
 */
export function schemas(): Record<string, JsonSchema.JsonSchema> {
  return Object.fromEntries(
    Object.entries(schemasByKind).map(([name, schema]) => {
      const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' });
      return [
        name,
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          ...document.schema,
          $defs: document.definitions,
        },
      ];
    }),
  );
}

/**
 * Attaches the accepted syntax and a human-readable annotation to a string decoder.
 */
function patternedString(pattern: RegExp, expected: string): Schema.String {
  const description = expected.charAt(0).toUpperCase() + expected.slice(1) + '.';
  return Schema.String.check(Schema.isPattern(pattern, { expected })).annotate({ description });
}
