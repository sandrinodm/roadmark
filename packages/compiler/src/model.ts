import type { Brand } from './brand-schema.ts';

/**
 * Document kinds in the source tree.
 */
export type Kind = 'set' | 'item' | 'release';

/**
 * A resolved roadmap record with Markdown already rendered for the deployment base.
 */
export type Entity = {
  /**
   * Record type used to select the detail template and group related documents.
   */
  kind: Kind;

  /**
   * Stable workspace identifier used in references and generated routes.
   */
  id: string;

  /**
   * Record title shown on its detail page and in roadmap listings.
   */
  title: string;

  /**
   * Summary shown in lists and search results.
   */
  description: string;

  /**
   * Workspace-relative input path used to resolve files and report findings.
   */
  source: string;

  /**
   * Escaped, rendered Markdown ready for insertion into the detail page.
   */
  html: string;

  /**
   * Plain text extracted from Markdown for the offline search index.
   */
  text: string;

  /**
   * Intended customer or business result against which readers can assess the work.
   */
  outcome?: string;

  /**
   * ID of the accountable product manager after inheritance.
   */
  pm?: string;

  /**
   * ID of the accountable engineering team after inheritance.
   */
  engineering_team?: string;

  /**
   * Indicates that the item uses its feature set's product manager.
   */
  inherited_pm?: boolean;

  /**
   * Indicates that the item uses its feature set's engineering owner.
   */
  inherited_engineering_team?: boolean;

  /**
   * Stable ID of the enclosing feature set for an item.
   */
  set?: string;

  /**
   * Stable ID of the release containing the work.
   */
  release?: string;

  /**
   * Lifecycle state that drives badges and delivery counts.
   */
  status?: string;

  /**
   * First scheduled day, expressed as a calendar date.
   */
  start?: string;

  /**
   * Planned delivery day or inclusive planning window.
   */
  target?: string;

  /**
   * Actual delivery day recorded for a shipped release.
   */
  shipped_on?: string;

  /**
   * Person IDs explicitly credited with a contribution to an item.
   */
  contributors?: Array<string>;

  /**
   * Team IDs for teams helping deliver an item alongside its owner.
   */
  contributing_teams: Array<string>;

  /**
   * Prerequisite items and the reason each prerequisite matters.
   */
  depends_on: Array<{ item: string; reason?: string }>;

  /**
   * Named external web resources in authored order.
   */
  links?: ReadonlyArray<{ readonly label: string; readonly url: string }>;

  /**
   * Issue keys to include in the search index and link to Jira.
   */
  jira: Array<string>;
};

/**
 * Resolved settings and people and team registries for the roadmap.
 */
export type Workspace = {
  /**
   * Version of the authoring contract understood by the compiler.
   */
  schema_version: 1;

  /**
   * Workspace title used in the site header and page titles.
   */
  title: string;

  /**
   * Stable person identifiers mapped to display names.
   */
  people: Record<string, string>;

  /**
   * Stable team identifiers mapped to display names.
   */
  teams: Record<string, string>;

  /**
   * Optional published avatar paths, roles and memberships keyed by stable person ID.
   */
  person_details?: Record<string, { avatar?: string; role?: string; teams?: Array<string> }>;

  /**
   * Optional team profile descriptions keyed by stable team ID.
   */
  team_details?: Record<string, { description?: string }>;

  /**
   * Instance URL used to turn Jira keys into browse links.
   */
  jira_base_url?: string;
};

/**
 * Source positions count from one, with workspace-relative file names.
 */
export type Diagnostic = {
  /**
   * Determines whether the issue blocks normal or strict builds.
   */
  severity: 'error' | 'warning';

  /**
   * Stable diagnostic code used by automation and regression fixtures.
   */
  rule: string;

  /**
   * Workspace-relative path of the source reported by this diagnostic.
   */
  file: string;

  /**
   * One-based source line in the authored file.
   */
  line: number;

  /**
   * One-based source column of the closest author-editable node.
   */
  column: number;

  /**
   * Explanation of the issue suitable for display in a terminal or preview.
   */
  message: string;

  /**
   * Suggested change the author can make to resolve the issue.
   */
  fix: string;

  /**
   * Other source positions relevant to the same diagnostic.
   */
  related?: Array<{ file: string; line: number; column: number }>;
};

/**
 * Content files retain their fingerprinted public path across pages.
 */
export type Asset = {
  /**
   * Workspace-relative file copied into the generated site at publication time.
   */
  source: string;

  /**
   * Fingerprint-based destination relative to the generated site root.
   */
  output: string;

  /**
   * Compiled bytes for derivatives that replace the original file at publication.
   */
  bytes?: Uint8Array;

  /**
   * Site-relative path of the PNG poster generated from an animated image's first frame.
   */
  poster?: string;
};

/**
 * One compiler result drives diagnostics, publishing and preview.
 */
export type Compilation = {
  /**
   * Resolved author settings and registries, or fallback settings after a configuration error.
   */
  workspace: Workspace;

  /**
   * Optional workspace theme with resolved public paths for brand assets.
   */
  brand?: Brand;

  /**
   * Normalized feature sets, items and releases.
   */
  entities: Array<Entity>;

  /**
   * Findings ordered by source path, line and column.
   */
  diagnostics: Array<Diagnostic>;

  /**
   * Files referenced by the compiled site, collected for publication.
   */
  assets: Array<Asset>;

  /**
   * Static SVG files generated from authored diagram fences.
   */
  diagrams?: ReadonlyMap<string, string>;
};
