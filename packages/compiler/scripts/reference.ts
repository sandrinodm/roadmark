import { Schema } from 'effect';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { schemas } from '../src/schemas.ts';

/**
 * Accepts the scalar literals emitted for field choices and fixed values.
 */
const ScalarSchema = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null]);

/**
 * Reads the JSON Schema keywords displayed in each field's table row.
 */
const PropertySchema = Schema.Struct({
  /**
   * Primitive JSON type emitted by the schema generator.
   */
  type: Schema.optionalKey(Schema.String),

  /**
   * Closed set of values an author may select.
   */
  enum: Schema.optionalKey(Schema.Array(ScalarSchema)),

  /**
   * Single literal accepted for this field.
   */
  const: Schema.optionalKey(ScalarSchema),

  /**
   * Summary shown in lists and search results.
   */
  description: Schema.optionalKey(Schema.String),
});

/**
 * Reads the field definitions and required keys for an authored object.
 */
const FieldsSchema = Schema.Struct({
  /**
   * Named fields available on an object entry.
   */
  properties: Schema.optionalKey(Schema.Record(Schema.String, PropertySchema)),

  /**
   * Keys that must appear in the authored document.
   */
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

/**
 * Reads the alternative shapes accepted for each directory entry.
 */
const DirectoryEntrySchema = Schema.Struct({
  /**
   * Includes alternatives such as a display name or an authored object.
   */
  anyOf: Schema.optionalKey(Schema.Array(FieldsSchema)),
});

/**
 * Reads the fields of a named document or the entry shapes of a directory.
 */
const RootFieldsSchema = Schema.Struct({
  ...FieldsSchema.fields,
  /**
   * Directory entries keyed by stable IDs matching the slug expression.
   */
  patternProperties: Schema.optionalKey(Schema.Record(Schema.String, DirectoryEntrySchema)),
});

/**
 * Checks the fields and local definitions used to render a reference document.
 */
const isReferenceSchema = Schema.is(
  Schema.Struct({
    ...RootFieldsSchema.fields,
    /**
     * Reference to a definition in the same schema document.
     */
    $ref: Schema.optionalKey(Schema.String),

    /**
     * Holds the named schemas used to resolve local references.
     */
    $defs: Schema.optionalKey(Schema.Record(Schema.String, RootFieldsSchema)),
  }),
);

/**
 * Selects drift detection instead of updating checked-in reference files.
 */
const check = process.argv.includes('--check');

/**
 * Directory for the generated editor schemas and field reference.
 */
const destination = new URL('../../../docs/', import.meta.url);

/**
 * Domain-specific explanations for the fields exposed in the authoring reference.
 */
const fieldHelp = new Map<string, string>([
  ['schema_version', 'Workspace format version.'],
  ['title', 'Display name used in navigation and search.'],
  ['people', 'Map PM identifiers to display names.'],
  ['teams', 'Map team identifiers to display names.'],
  ['jira_base_url', 'HTTPS address of the Jira instance, before /browse/.'],
  ['id', 'Stable workspace-wide identifier used in URLs and references.'],
  ['description', 'Short summary for lists and search.'],
  ['outcome', 'The change a reader should expect for customers or the business.'],
  ['pm', 'Accountable PM from the people directory.'],
  ['engineering_team', 'Accountable team from the teams directory.'],
  ['status', 'Current lifecycle state.'],
  ['release', 'ID of the release containing this work.'],
  ['start', 'First planned day of work.'],
  ['target', 'Intended delivery date or window.'],
  ['shipped_on', 'Actual release day. Required for shipped releases.'],
  ['contributing_teams', 'Teams helping the accountable engineering team.'],
  ['contributors', 'People directly contributing to this item.'],
  ['depends_on', 'Item prerequisites with optional reasons.'],
  ['jira', 'Searchable Jira issue keys.'],
]);
let reference =
  '# Roadmap field reference\n\nThe compiler generates this reference and the editor schemas from its runtime definitions. The linter also checks calendar dates, file paths and relationships across documents.\n';
await mkdir(new URL('schemas/', destination), { recursive: true });
for (const [name, schema] of Object.entries(schemas())) {
  const root =
    isReferenceSchema(schema) &&
    (schema.$ref ? schema.$defs?.[schema.$ref.split('/').at(-1) ?? ''] : schema);
  if (!root) {
    throw new Error('Expected object schema for ' + name);
  }

  reference += '\n## ' + name[0]?.toUpperCase() + name.slice(1) + '\n';
  let fields = root;
  if (root.patternProperties) {
    const entry = Object.values(root.patternProperties)[0]?.anyOf?.find((type) => type.properties);
    if (!entry) {
      throw new Error('Expected directory entry schema for ' + name);
    }

    fields = entry;
    reference += '\nEach stable ID maps to a display name or an object with these fields.\n';
  }

  reference += '\n| Field | Required | Values | Meaning |\n|---|---|---|---|\n';
  for (const [key, prop] of Object.entries(fields.properties ?? {})) {
    const value = prop.enum?.join(', ') ?? String(prop.const ?? prop.type ?? 'See schema');
    const requirement = fields.required?.includes(key) ? 'Yes' : 'No';
    const help =
      name === 'people' && key === 'teams'
        ? 'Team memberships.'
        : (fieldHelp.get(key) ?? prop.description ?? '');
    reference += `| \`${key}\` | ${requirement} | ${value} | ${help} |\n`;
  }

  reference += '\n[Editor schema](schemas/' + name + '.json)\n';
  await emit('schemas/' + name + '.json', JSON.stringify(schema, null, 2) + '\n');
}

await emit('reference.md', reference);

/**
 * Writes one generated document or compares its contents byte for byte in check mode.
 */
async function emit(name: string, contents: string): Promise<void> {
  const file = new URL(name, destination);
  if (!check) {
    await writeFile(file, contents);
    return;
  }

  if ((await readFile(file, 'utf8')) !== contents) {
    throw new Error('Regenerate docs/' + name + ' with pnpm reference.');
  }
}
