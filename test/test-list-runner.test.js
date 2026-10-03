'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const A = require('./_assert.js');

(async () => {
  const root = path.resolve(__dirname, '..');
  const runner = await import(pathToFileURL(path.join(root, 'scripts', 'run-test-list.mjs')).href);
  for (const name of ['fast.list', 'http.list']) {
    const steps = runner.readSteps(path.join(__dirname, name));
    A.ok(steps.length > 0, name + ' contains runnable steps');
    A.eq(new Set(steps).size, steps.length, name + ' contains no duplicate suite');
    A.ok(steps.every(step => fs.existsSync(path.join(root, step))), name + ' references only existing files');
  }
  const http = runner.readSteps(path.join(__dirname, 'http.list'));
  A.eq(http[0], 'test/provider-recovery.e2e.test.js', 'provider production-composition proof is part of the HTTP manifest');
  A.ok(http.includes('test/sidecar.http.test.js') && http.includes('test/openai-compat.e2e.test.js'), 'HTTP manifest retains route coverage');

  /* THE REVERSE DIRECTION — the one the manifest never checked.
     Every check above goes LIST -> FILE ("every listed file exists"). None went FILE -> LIST, so a `.test.js`
     that was never added to either manifest ran in NO suite and NOTHING noticed: it was a green-looking file
     with no runner. That is the same SILENT-SHADOW shape as a duplicated route (a handler that looks alive and
     is dead); the failure is an absence, and an absence is exactly what a positive test cannot see.
     Literal case, found by this check: `businessdtwin.test.js` shipped with the Digital Twin console, stayed
     out of both lists, and its sibling `onboarding-legibility.test.js` sat unrun while a real gap (a
     `data-hint` with no glossary copy) went unreported. A test nobody runs is not coverage. */
  const listed = new Set([...runner.readSteps(path.join(__dirname, 'fast.list')), ...http]);
  const onDisk = fs.readdirSync(__dirname).filter(f => /\.test\.js$/.test(f)).map(f => 'test/' + f);
  const orphaned = onDisk.filter(f => !listed.has(f)).sort();
  A.eq(orphaned, [], 'every test/*.test.js is in fast.list or http.list — an unlisted suite runs in NO runner and its failures are invisible');

  A.report('test-list-runner.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
