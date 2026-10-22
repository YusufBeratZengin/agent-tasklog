import { runCLI } from '../src/cli.js';

// Each child exercises the CLI parser and storage path 25 times in one process.
for (let index = 0; index < 25; index++) {
  const code = await runCLI(['add', '--area=stress', `--title=Job ${index}`, '--next=Check log', '--due=2026-10-22'], {
    write: () => {},
  });
  if (code !== 0) process.exit(code);
}
