import { Schema } from 'effect';

/**
 * A workspace that could not be compiled for a reason other than its content, such as a failing
 * renderer. Content problems are diagnostics, never this error.
 */
export class ContentError extends Schema.TaggedError<
  ContentError,
  {
    /**
     * Distinguishes content errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('ContentError', {
  /**
   * Explains the failure, keeping the underlying error's message.
   */
  message: Schema.String,
}) {}

/**
 * An MDX document that could not be compiled, bundled or rendered.
 */
export class MdxError extends Schema.TaggedError<
  MdxError,
  {
    /**
     * Distinguishes MDX errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('MdxError', {
  /**
   * The compiler's explanation.
   */
  message: Schema.String,

  /**
   * One-based line within the document body, when the compiler reports one.
   */
  line: Schema.Finite,

  /**
   * One-based column, when the compiler reports one.
   */
  column: Schema.Finite,
}) {}

/**
 * A brand asset that could not be read or does not match its declared format.
 */
export class BrandAssetError extends Schema.TaggedError<
  BrandAssetError,
  {
    /**
     * Distinguishes brand asset errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('BrandAssetError', {
  /**
   * Workspace-relative path of the asset.
   */
  file: Schema.String,

  /**
   * Why the asset was rejected.
   */
  message: Schema.String,
}) {}
