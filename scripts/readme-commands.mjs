export function commandTableErrors(help, source) {
  const commands = [...help.matchAll(/^  tasklog ([a-z]+(?: [a-z]+)*)\b/gm)].map((match) => match[1]);
  const documented = [...source.matchAll(/^\| `([a-z]+(?: [a-z]+)*)(?: [^`]*)?` \|/gm)].map((match) => match[1]);
  return [
    ...commands.filter((command) => !documented.includes(command)).map((command) => `Command table is missing '${command}' from --help.`),
    ...documented.filter((command) => !commands.includes(command)).map((command) => `Command table includes unknown command '${command}'.`),
  ];
}
