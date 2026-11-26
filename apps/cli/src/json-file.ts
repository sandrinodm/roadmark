import { Effect, Schema } from 'effect';

import { errorText } from './run.ts';

/**
 * A JSON file that could not be parsed, naming the file and the parser's position.
 */
export class JsonFileError extends Schema.TaggedError<
  JsonFileError,
  {
    /**
     * Distinguishes JSON file errors from structurally similar values.
     */
    readonly brand: unique symbol;
  }
>()('JsonFileError', {
  /**
   * Absolute path of the unreadable file.
   */
  file: Schema.String,

  /**
   * The file path followed by the parser's explanation.
   */
  message: Schema.String,
}) {}

/**
 * Builds a decoder for the text of a JSON file.
 *
 * The text is decoded with `Schema.fromJsonString`. That reports only "Expected a valid JSON
 * string" for broken syntax, and authors repairing a damaged manifest need the file and the
 * parser's position, so on failure the text is parsed once more only to recover the `SyntaxError`.
 * If it parses, the failure was the schema's and is returned unchanged.
 *
 * @param schema The expected shape of the document.
 * @returns A function from a path and its contents to the decoded document.
 */
export function decodeJsonFile<S extends Schema.Decoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
  return (
    file: string,
    text: string,
  ): Effect.Effect<S['Type'], JsonFileError | Schema.SchemaError> =>
    decode(text).pipe(
      Effect.catchTag('SchemaError', (error) =>
        Effect.try({
          try: () => {
            // oxlint-disable-next-line slop/no-raw-json-parse, effecttsgo/global-json-in-effect -- Only recovers the SyntaxError position for the message; see above.
            JSON.parse(text);
          },
          catch: (cause) =>
            new JsonFileError({ file, message: `Could not parse ${file}: ${errorText(cause)}` }),
        }).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );
}
