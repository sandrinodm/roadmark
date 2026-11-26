import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SafeHtml } from './html.ts';

import { escapeHtml, html, joinHtml, trustedHtml } from './html.ts';

/**
 * Renders one list row from author text.
 */
function row(label: string): SafeHtml {
  return html`<li title="${label}">${label}</li>`;
}

void describe('html templates', () => {
  void it('escapes author text in nested templates and keeps trusted markup intact', () => {
    const title = 'Release <Beta> & "friends"';
    const body = trustedHtml('<p>Compiled <em>Markdown</em></p>');
    const page = html`<section>
      ${html`<h2>${title}</h2>`}${body}
      <ul>
        ${['a<b', "it's"].map(row)}
      </ul>
    </section>`;
    assert.equal(
      page.toString().replaceAll(/>\s+</g, '><'),
      '<section><h2>Release &lt;Beta&gt; &amp; &quot;friends&quot;</h2>' +
        '<p>Compiled <em>Markdown</em></p>' +
        '<ul><li title="a&lt;b">a&lt;b</li><li title="it&#39;s">it&#39;s</li></ul></section>',
    );
  });

  void it('renders numbers, skips absent values and joins with a trusted separator', () => {
    const empty: string | undefined = undefined;
    assert.equal(html`${3}${false}${null}${empty}${''}`.value, '3');
    assert.equal(joinHtml(['<a>', html`<b>`], html` · `).value, '&lt;a&gt; · <b>');
  });

  void it('rejects objects that only look like SafeHtml', () => {
    // Each forgery satisfies the SafeHtml type structurally, so only the runtime check stops it.
    const copied = html`<b>copied</b>`;
    const forgeries: Array<SafeHtml> = [
      { value: '<script>alert(1)</script>', toString: () => '<script>' },
      { value: '<img src=x onerror=alert(1)>', toString: () => '' },
      { ...copied },
      Object.freeze({ value: copied.value, toString: copied.toString }),
    ];
    for (const forged of forgeries) {
      assert.throws(() => html`${forged}`, TypeError);
      assert.throws(() => html`${[forged]}`, TypeError);
      assert.throws(() => joinHtml([forged]), TypeError);
    }

    assert.equal(html`${'<script>'}`.value, '&lt;script&gt;');
    assert.equal(escapeHtml(`<img src=x onerror="1">`), '&lt;img src=x onerror=&quot;1&quot;&gt;');
  });

  void it('keeps escaped author text escaped inside nested trusted markup', () => {
    const author = '</em><script>x</script>';
    const nested = html`<div>${trustedHtml('<em>')}${author}${trustedHtml('</em>')}</div>`;
    assert.equal(nested.value, '<div><em>&lt;/em&gt;&lt;script&gt;x&lt;/script&gt;</em></div>');
    assert.ok(Object.isFrozen(nested));
  });
});
