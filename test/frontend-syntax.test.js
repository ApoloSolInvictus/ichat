import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('inline browser JavaScript compiles', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/type\s*=\s*["']module["']/i.test(match[1]) && !/src\s*=/i.test(match[1]))
    .map((match) => match[2]);

  assert.ok(scripts.length > 0);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new Function(source), `inline script ${index + 1} should compile`);
  });

  assert.equal(
    [...html.matchAll(/translate\.google\.com\/translate_a\/element\.js/g)].length,
    1,
    'Google Translate should load only once'
  );
  assert.match(html, /pageLanguage:\s*'en'/, 'English must remain the source language');
  assert.match(html, /autoDisplay:\s*false/, 'Google Translate must not auto-display or auto-select');
  assert.match(html, /clearGoogleTranslateCookie/, 'previous automatic language choices must be cleared');
  assert.match(html, /setGoogleTranslateCookie/, 'manual language choices must be persisted explicitly');
  assert.match(html, /location\.reload\(\)/, 'manual language changes must reload to apply the translation');
});
