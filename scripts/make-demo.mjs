import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLI } from '../src/cli.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'docs', 'demo.svg');
const commands = [['resume'], ['list', '--all'], ['cost', 'total']];

// Exercise the real CLI against a copy of the versioned synthetic example.
export async function captureDemo() {
  const base = join(root, 'is');
  await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(join(base, 'demo-'));
  try {
    await cp(join(root, 'examples', '.tasklog'), join(cwd, '.tasklog'), { recursive: true });
    const sessions = [];
    for (const args of commands) {
      let stdout = '';
      let stderr = '';
      const code = await runCLI(args, { cwd,
        write: (value) => { stdout += `${value}\n`; },
        writeError: (value) => { stderr += `${value}\n`; },
      });
      if (code !== 0) throw new Error(`Demo command failed: tasklog ${args.join(' ')}: ${stderr}`);
      sessions.push(`$ tasklog ${args.join(' ')}\n${stdout.trimEnd()}`);
    }
    return `${sessions.join('\n\n')}\n`;
  } finally {
    if (!resolve(cwd).startsWith(`${resolve(base)}${sep}`)) throw new Error('Unsafe demo cleanup path.');
    await rm(cwd, { recursive: true, force: true });
  }
}

function escapeXML(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function renderDemo(transcript) {
  const lines = transcript.trimEnd().split('\n');
  const width = 960;
  const height = 100 + lines.length * 26;
  const rows = lines.map((line, index) => {
    const color = line.startsWith('$ ') ? '#7ee787' : '#e6edf3';
    return `    <text x="30" y="${91 + index * 26}" fill="${color}">${escapeXML(line)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">agent-tasklog: resume work, list tasks, and total receipts</title>
  <desc id="desc">Real CLI output from the synthetic example log. The waiting parser task retains its next action and checkpoint; receipts total exactly 0.3 credits.</desc>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="16" fill="#0d1117" stroke="#30363d"/>
  <path d="M17 1h926a16 16 0 0 1 16 16v35H1V17A16 16 0 0 1 17 1Z" fill="#161b22"/>
  <circle cx="27" cy="27" r="6" fill="#ff5f57"/>
  <circle cx="49" cy="27" r="6" fill="#febc2e"/>
  <circle cx="71" cy="27" r="6" fill="#28c840"/>
  <text x="480" y="32" fill="#8b949e" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="13">agent-tasklog / examples</text>
  <g font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="16" xml:space="preserve">
${rows}
  </g>
</svg>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const transcript = await captureDemo();
  const svg = renderDemo(transcript);
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== svg) throw new Error('Demo is stale. Run npm run demo.');
    console.log(`Demo matches real CLI output (${transcript.trimEnd().split('\n').length} terminal lines).`);
  } else {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(destination, svg);
    console.log('Generated docs/demo.svg from real CLI output.');
  }
}
