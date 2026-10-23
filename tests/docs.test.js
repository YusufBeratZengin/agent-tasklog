import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { commandTableErrors } from '../scripts/readme-commands.mjs';
import { captureDemo, renderDemo } from '../scripts/make-demo.mjs';
import { root, cli, workspace } from '../support/helpers.js';

function headingLevels(source) {
  let fenced = false;
  return source.split('\n').flatMap((line) => {
    if (line.startsWith('```')) fenced = !fenced;
    const match = !fenced && /^(#{1,6}) /.exec(line);
    return match ? [match[1].length] : [];
  });
}

test('both READMEs have matching headings, help tables and the standalone agent snippet', async (t) => {
  const cwd = await workspace(t);
  const en = await readFile(join(root, 'README.md'), 'utf8');
  const tr = await readFile(join(root, 'README.tr.md'), 'utf8');
  assert.deepEqual(headingLevels(tr), headingLevels(en));
  const help = (await cli(cwd, ['--help'])).stdout;
  assert.deepEqual(commandTableErrors(help, en), []);
  assert.deepEqual(commandTableErrors(help, tr), []);
  const snippet = /```markdown\n([\s\S]*?)```/.exec(en)[1];
  assert.equal(await readFile(join(root, 'examples', 'AGENTS.snippet.md'), 'utf8'), snippet);
  assert.match(snippet, /tasklog resume --json/);
  const copy = join(cwd, 'README.md');
  await writeFile(copy, en);
  const modifiedHelp = help.replace('  tasklog export', '  tasklog inspect\n  tasklog export');
  assert.deepEqual(commandTableErrors(modifiedHelp, await readFile(copy, 'utf8')), ["Command table is missing 'inspect' from --help."]);
});

test('both README transcripts and the demo SVG equal real CLI output', async () => {
  const en = await readFile(join(root, 'README.md'), 'utf8');
  const tr = await readFile(join(root, 'README.tr.md'), 'utf8');
  const transcript = /```console\n([\s\S]*?)```/.exec(en)[1];
  assert.equal(/```console\n([\s\S]*?)```/.exec(tr)[1], transcript);
  assert.equal(transcript, await captureDemo());
  assert.equal(await readFile(join(root, 'docs', 'demo.svg'), 'utf8'), renderDemo(transcript));
});

test('README tasklog usage commands and the runnable snapshot example succeed', async (t) => {
  for (const file of ['README.md', 'README.tr.md']) {
    const cwd = await workspace(t);
    const source = await readFile(join(root, file), 'utf8');
    let taskID;
    for (const block of source.matchAll(/```sh\n([\s\S]*?)```/g)) {
      for (const command of block[1].split('\n').filter((line) => /^(?:tasklog |node bin\/tasklog\.js )/.test(line))) {
        const args = command.replace(/^(?:tasklog |node bin\/tasklog\.js )/, '').match(/"[^"]*"|\S+/g).map((part) => part.replace(/^"|"$/g, ''))
          .map((part) => /^t-[0-9a-f]{8}$/.test(part) ? taskID : part);
        const result = await cli(cwd, args);
        assert.equal(result.code, 0, `${file}: ${command}: ${result.stderr}`);
        if (args[0] === 'add') taskID = result.stdout.split(' ')[0];
      }
    }
  }
  const example = await workspace(t);
  await cp(join(root, 'examples', '.tasklog'), join(example, '.tasklog'), { recursive: true });
  const source = await readFile(join(root, 'examples', 'README.md'), 'utf8');
  for (const command of source.split('\n').filter((line) => line.startsWith('tasklog '))) {
    const result = await cli(example, command.slice(8).split(' '));
    assert.equal(result.code, 0, result.stderr);
  }
});
