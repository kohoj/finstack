import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('desk command', () => {
  it('keeps its loopback server alive after printing the launch result', async () => {
    const home = mkdtempSync(join(tmpdir(), 'finstack-desk-command-'));
    homes.push(home);
    const cli = new URL('../../src/cli.ts', import.meta.url).pathname;
    const deskProcess = Bun.spawn([process.execPath, cli, 'desk', '--no-open'], {
      env: { ...process.env, FINSTACK_HOME: home, FINSTACK_DESK_PORT: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = deskProcess.stdout.getReader();
    let output = '';
    let exited = false;
    deskProcess.exited.then(() => {
      exited = true;
    });

    try {
      while (!output.includes('"message"')) {
        const next = await Promise.race([reader.read(), Bun.sleep(3_000).then(() => null)]);
        if (!next || next.done) throw new Error('Desk command did not print its launch result');
        output += new TextDecoder().decode(next.value);
      }
      const connection = JSON.parse(output) as { url: string };
      const landing = await fetch(connection.url, { redirect: 'manual' });
      const cookie = landing.headers.get('set-cookie')?.split(';')[0];
      if (landing.status !== 302 || !cookie)
        throw new Error('Desk launch did not create a session');
      const launch = new URL(connection.url);
      const health = await fetch(`${launch.origin}/health`, {
        headers: { cookie },
      });

      expect(health.status).toBe(200);
      expect((await health.json()).ok).toBe(true);
      await Bun.sleep(20);
      expect(exited).toBe(false);
    } finally {
      await reader.cancel();
      deskProcess.kill('SIGTERM');
      await deskProcess.exited;
    }
  });
});
