import { Result, Schema, SchemaIssue } from 'effect';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brandSchema, stillImagePath, TYPE_ROLES } from './brand-schema.ts';

/**
 * Flattens nested decoder issues into one entry per field path.
 */
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Decodes like the brand reader and returns the dotted issue paths, or an empty list.
 */
function issues(value: unknown, schema: Schema.Decoder<unknown> = brandSchema): Array<string> {
  const result = Schema.decodeUnknownResult(schema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(value);
  if (Result.isSuccess(result)) {
    return [];
  }

  return formatIssue(result.failure.issue).issues.map(({ path = [] }) =>
    path.map((part) => String(typeof part === 'object' ? part.key : part)).join('.'),
  );
}

/**
 * Wraps one part of the configuration in a valid brand file.
 */
function brand<Fields extends object>(fields: Fields): Fields & { schema_version: 1 } {
  return { ...fields, schema_version: 1 };
}

/**
 * Decodes a brand whose body font has the given weight.
 */
function weightIssues(weight: unknown): Array<string> {
  return issues(brand({ typography: { body: { font: { family: 'Inter', weight } } } }));
}

/**
 * Decodes a brand whose header logo has the given size settings.
 */
function logoIssues(size: { height?: number; aspect?: number }): Array<string> {
  return issues(brand({ header: { logo: { file: 'logo.png', ...size } } }));
}

void describe('brandSchema', () => {
  void it('accepts a complete brand configuration', () => {
    assert.deepEqual(
      issues(
        brand({
          colors: { background: '#fff', accent: '#2457A6', inverse_text: '#000000' },
          typography: {
            body: {
              font: {
                family: 'Bricolage Grotesque',
                file: 'fonts/body.woff2',
                weight: [200, 800],
                license: 'fonts/OFL.txt',
              },
              tracking: -0.01,
              line_height: 1.5,
            },
            display: { font: { family: 'Inter', weight: 700 } },
            header: { tracking: 0.3, line_height: 0.8 },
          },
          header: {
            background: '#123',
            logo: { file: 'brand/logo.webp', height: 64, aspect: 3.5, show_title: false },
          },
          background: { image: 'brand/paper.jpg', fit: 'tile', position: 'top left' },
        }),
      ),
      [],
    );
    assert.deepEqual(issues({ schema_version: 1 }), []);
  });

  void it('requires schema version 1 and rejects unknown keys', () => {
    assert.deepEqual(issues({}), ['schema_version']);
    assert.deepEqual(issues({ schema_version: 2 }), ['schema_version']);
    assert.deepEqual(issues(brand({ colours: {} })), ['colours']);
    assert.deepEqual(issues(brand({ colors: { link: '#fff' } })), ['colors.link']);
  });

  void it('accepts only three- or six-digit hex colors', () => {
    for (const color of ['#abc', '#A1B2C3']) {
      assert.deepEqual(issues(brand({ colors: { text: color } })), [], color);
    }

    for (const color of ['abc', '#abcd', '#12345', '#1234567', '#ggg', 'red', '#fff\n']) {
      assert.deepEqual(issues(brand({ colors: { text: color } })), ['colors.text'], color);
    }
  });

  void it('bounds font weights and requires an ascending integer range', () => {
    assert.deepEqual(weightIssues(100), []);
    assert.deepEqual(weightIssues(900), []);
    assert.deepEqual(weightIssues([400, 400]), []);
    for (const value of [50, 950, 450.5, [700, 300], [300, 1000]]) {
      assert.notDeepEqual(weightIssues(value), [], JSON.stringify(value));
    }
  });

  void it('rejects a font license without a local font file and unsafe family names', () => {
    assert.deepEqual(
      issues(brand({ typography: { body: { font: { family: 'Inter', license: 'OFL.txt' } } } })),
      ['typography.body.font'],
    );
    for (const family of ['', ' Leading', 'Inter;}', 'Inter"', 'x'.repeat(81)]) {
      assert.deepEqual(
        issues(brand({ typography: { display: { font: { family } } } })),
        ['typography.display.font.family'],
        family,
      );
    }
  });

  void it('bounds tracking, line height, logo height and logo aspect', () => {
    assert.deepEqual(issues(brand({ typography: { body: { tracking: -0.13 } } })), [
      'typography.body.tracking',
    ]);
    assert.deepEqual(issues(brand({ typography: { body: { line_height: 2.6 } } })), [
      'typography.body.line_height',
    ]);
    assert.deepEqual(logoIssues({ height: 16, aspect: 14 }), []);
    assert.deepEqual(logoIssues({ height: 15 }), ['header.logo.height']);
    assert.deepEqual(logoIssues({ height: 32.5 }), ['header.logo.height']);
    assert.deepEqual(logoIssues({ aspect: 0.05 }), ['header.logo.aspect']);
    assert.deepEqual(
      new Set(logoIssues({ aspect: Number.POSITIVE_INFINITY })),
      new Set(['header.logo.aspect']),
    );
  });

  void it('restricts logos to PNG or WebP and backgrounds to known layouts', () => {
    assert.deepEqual(issues(brand({ header: { logo: { file: 'logo.jpg' } } })), [
      'header.logo.file',
    ]);
    assert.deepEqual(issues(brand({ header: { logo: { file: 'logo.svg' } } })), [
      'header.logo.file',
    ]);
    assert.deepEqual(issues(brand({ background: { image: 'paper.png', fit: 'stretch' } })), [
      'background.fit',
    ]);
    assert.deepEqual(issues(brand({ background: { image: 'paper.png', position: 'bottom' } })), [
      'background.position',
    ]);
    assert.deepEqual(issues(brand({ background: { fit: 'cover' } })), ['background.image']);
  });
});

void describe('stillImagePath', () => {
  void it('accepts normalized relative paths to PNG, JPEG or WebP files', () => {
    for (const file of ['a.png', 'people/alex.jpg', 'people/alex.jpeg', 'my brand/logo v2.webp']) {
      assert.deepEqual(issues(file, stillImagePath), [], file);
    }
  });

  void it('rejects other formats and paths that are absolute, hidden, escaping or not normalized', () => {
    for (const file of [
      'animation.gif',
      'vector.svg',
      'photo.PNG',
      '/abs/photo.png',
      '../photo.png',
      'a/../photo.png',
      './photo.png',
      '.hidden.png',
      'a//photo.png',
      String.raw`a\photo.png`,
      'photo.png\n',
      'png',
    ]) {
      assert.notDeepEqual(issues(file, stillImagePath), [], file);
    }
  });
});

void describe('TYPE_ROLES', () => {
  void it('lists the typography roles a brand can style, in resolution order', () => {
    assert.deepEqual(TYPE_ROLES, ['body', 'display', 'header']);
  });
});
