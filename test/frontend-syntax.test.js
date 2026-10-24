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
});
