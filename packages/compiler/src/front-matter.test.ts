import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Diagnostic } from './model.ts';

import { parseSource } from './front-matter.ts';
import { schemaFor } from './schemas.ts';

/**
 * A small document schema with a required key, an optional number and a nested list.
 */
const DOCUMENT = Schema.Struct({
  id: Schema.String,
  count: Schema.optionalKey(Schema.Finite),
  list: Schema.optionalKey(Schema.Array(Schema.Struct({ item: Schema.String }))),
});

/**
 * Parses Markdown with front matter, or plain YAML when `file` ends in `.yaml`.
 */
function parse(text: string, file = 'items/a.md', schema: Schema.Decoder<unknown> = DOCUMENT) {
  const diagnostics: Array<Diagnostic> = [];
  const frontMatter = !file.endsWith('.yaml');
  const source = parseSource(file, text, schema, { diagnostics, frontMatter });
  return { source, diagnostics };
}

/**
 * Reduces diagnostics to their rule and one-based position.
 */
function located(diagnostics: Array<Diagnostic>): Array<[string, number, number]> {
  return diagnostics.map(({ rule, line, column }) => [rule, line, column]);
}

void describe('parseSource', () => {
  void it('splits front matter from the body and counts the lines before the body', () => {
    const { source, diagnostics } = parse('---\nid: a\ncount: 2\n---\n# Title\n\nBody');
    assert.deepEqual(diagnostics, []);
    assert.ok(source);
    assert.deepEqual(source.data, { id: 'a', count: 2 });
    assert.equal(source.file, 'items/a.md');
    assert.equal(source.markdown, '# Title\n\nBody');
    assert.equal(source.bodyLineOffset, 4);
  });

  void it('accepts a byte order mark, CRLF line endings and trailing spaces on delimiters', () => {
    const { source, diagnostics } = parse('﻿---  \r\nid: a\r\n--- \t\r\nLine 1\r\nLine 2');
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(source?.data, { id: 'a' });
    assert.equal(source.markdown, 'Line 1\nLine 2');
    assert.equal(source.bodyLineOffset, 3);
  });

  void it('locates nested fields in the original file and falls back to the closest parent', () => {
    const { source } = parse('---\nid: a\nlist:\n  - item: x\n  - item: y\n---\n');
    assert.ok(source);
    assert.deepEqual(source.field(['id']), { file: 'items/a.md', line: 2, column: 1 });
    assert.deepEqual(source.field(['list', 1, 'item']), { file: 'items/a.md', line: 5, column: 5 });
    assert.deepEqual(source.field(['list', 9]), { file: 'items/a.md', line: 3, column: 1 });
    assert.deepEqual(source.field(['missing', 'deeper']), {
      file: 'items/a.md',
      line: 2,
      column: 1,
    });
    assert.deepEqual(source.field([]), { file: 'items/a.md', line: 2, column: 1 });
  });

  void it('reads a whole YAML file without an offset when front matter is not expected', () => {
    const { source, diagnostics } = parse('id: a\ncount: 1\n', 'roadmap.yaml');
    assert.deepEqual(diagnostics, []);
    assert.ok(source);
    assert.equal(source.markdown, '');
    assert.equal(source.bodyLineOffset, 0);
    assert.deepEqual(source.field(['count']), { file: 'roadmap.yaml', line: 2, column: 1 });
  });

  void it('requires front matter delimiters at the very start of a Markdown file', () => {
    for (const text of ['id: a\n', '---\nid: a\n', '\n---\nid: a\n---\n', '--- x\nid: a\n---\n']) {
      const { source, diagnostics } = parse(text);
      assert.equal(source, undefined, JSON.stringify(text));
      assert.deepEqual(located(diagnostics), [['front-matter', 1, 1]], JSON.stringify(text));
    }
  });

  void it('reports duplicate keys, including a number and its string spelling', () => {
    const repeated = parse('---\nid: a\ncount: 1\nid: b\n---\n');
    assert.equal(repeated.source, undefined);
    assert.deepEqual(located(repeated.diagnostics), [['duplicate-yaml-key', 4, 1]]);

    const spelled = parse('1: one\n"1": two\n', 'teams.yaml', schemaFor('teams'));
    assert.deepEqual(located(spelled.diagnostics), [['duplicate-yaml-key', 2, 1]]);
  });

  void it('reports YAML syntax errors on one line at their position', () => {
    const { source, diagnostics } = parse('---\nid: a\ncount: [1, 2\n---\n');
    assert.equal(source, undefined);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ rule }) => rule === 'invalid-yaml'));
    assert.ok(diagnostics.every(({ message }) => !message.includes('\n')));
    assert.ok(diagnostics.every(({ line }) => line >= 3));
  });

  void it('refuses YAML aliases', () => {
    const { source, diagnostics } = parse('---\nid: &name a\nlist:\n  - item: *name\n---\n');
    assert.equal(source, undefined);
    assert.deepEqual(located(diagnostics), [['invalid-yaml', 2, 1]]);
    assert.match(diagnostics[0]?.message ?? '', /aliases are unavailable/);
  });

  void it('reports every schema problem at its field with a fix', () => {
    const { source, diagnostics } = parse('---\ncount: many\nextra: 1\nlist:\n  - item: 3\n---\n');
    assert.equal(source, undefined);
    assert.deepEqual(
      diagnostics.map(({ rule, message, line, column }) => [
        rule,
        message.split(':')[0],
        line,
        column,
      ]),
      [
        ['unknown-field', 'extra', 3, 1],
        ['invalid-field', 'id', 2, 1],
        ['invalid-field', 'count', 2, 1],
        ['invalid-field', 'list[0].item', 5, 5],
      ],
    );
    assert.equal(diagnostics[0]?.message, 'extra: This field is not defined in the schema.');
    assert.equal(diagnostics[1]?.message, 'id: Missing key.');
    assert.equal(diagnostics[1].fix, 'Add the required field id.');
    assert.equal(diagnostics[2]?.fix, 'Replace the value with one in the expected format.');
    assert.ok(diagnostics.every(({ severity }) => severity === 'error'));
  });

  void it('names unknown nested keys by their full path', () => {
    const { diagnostics } = parse('---\nid: a\nlist:\n  - item: x\n    because: y\n---\n');
    assert.deepEqual(
      diagnostics.map(({ rule, message, line, column }) => [rule, message, line, column]),
      [['unknown-field', 'list[0].because: This field is not defined in the schema.', 5, 5]],
    );
  });

  void it('explains top-level fields that were removed from the format', () => {
    const { diagnostics } = parse(
      '---\nid: a\nmilestone: beta\ncompleted_on: 2028-01-01\nteam_dependencies: []\n---\n',
    );
    assert.deepEqual(located(diagnostics), [
      ['removed-field', 3, 1],
      ['removed-field', 4, 1],
      ['removed-field', 5, 1],
    ]);
    assert.match(diagnostics[0]?.message ?? '', /^milestone: Milestones are no longer/);
    assert.match(diagnostics[2]?.fix ?? '', /contributing_teams/);

    const nested = parse('---\nid: a\nlist:\n  - item: x\n    milestone: beta\n---\n');
    assert.deepEqual(located(nested.diagnostics), [['unknown-field', 5, 5]]);
  });

  void it('explains malformed registry IDs only where registry keys live', () => {
    const teams = parse('core: Core\nBad_Team: Bad\n', 'teams.yaml', schemaFor('teams'));
    assert.deepEqual(located(teams.diagnostics), [['invalid-registry-id', 2, 1]]);
    assert.match(
      teams.diagnostics[0]?.message ?? '',
      /^Bad_Team: Expected a lowercase registry ID/,
    );

    const people = parse('Alex: Alex Park\n', 'people.yaml', schemaFor('people'));
    assert.deepEqual(located(people.diagnostics), [['invalid-registry-id', 1, 1]]);

    const inline = parse(
      'schema_version: 1\ntitle: Roadmap\nteams:\n  Core: Core\n',
      'roadmap.yaml',
      schemaFor('workspace'),
    );
    assert.deepEqual(located(inline.diagnostics), [['invalid-registry-id', 4, 3]]);
    assert.match(inline.diagnostics[0]?.message ?? '', /^teams\.Core:/);

    const elsewhere = parse('core: Core\nBad_Team: Bad\n', 'other.yaml', schemaFor('teams'));
    assert.deepEqual(located(elsewhere.diagnostics), [['unknown-field', 2, 1]]);
  });

  void it('names the whole document when the YAML is not a mapping', () => {
    const { diagnostics } = parse('---\n---\nBody');
    assert.deepEqual(
      diagnostics.map(({ rule, message }) => [rule, message.split(':')[0]]),
      [['invalid-field', 'YAML']],
    );
  });
});
