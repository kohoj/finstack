import { execFile } from 'node:child_process';
import { ensureDesk, stopDesk } from '../desk/server';

function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  // The URL is generated from a loopback port and a random capability; never
  // interpreted by a shell.
  execFile(command, [url], () => {});
}

/**
 * `Bun.serve` does not itself keep a short-lived CLI invocation alive. The
 * workbench must therefore own a small signal-bound lifetime rather than
 * printing a capability URL for a server that has already exited.
 */
function waitForShutdown(): Promise<void> {
  return new Promise(resolve => {
    const shutdown = () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      stopDesk();
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

/** Launch the local Desk as a first-class client, not a generated report. */
export async function desk(args: string[]) {
  const connection = await ensureDesk();
  if (!args.includes('--no-open')) openUrl(connection.url);
  console.log(
    JSON.stringify(
      {
        ...connection,
        opened: !args.includes('--no-open'),
        message: 'Desk is running locally. It shares the same portfolio state as MCP and CLI.',
      },
      null,
      2,
    ),
  );
  await waitForShutdown();
}
