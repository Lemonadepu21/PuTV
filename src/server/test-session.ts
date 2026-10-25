import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, transaction } from './database';
import { createSession } from './identity';
let path = '';
export function signSession() {
  if (!path) {
    path = join(mkdtempSync(join(tmpdir(), 'putv-routes-')), 'identity.sqlite');
  }
  process.env.SQLITE_PATH = path;
  const id = randomUUID(),
    now = Date.now();
  transaction(() => {
    database()
      .prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)')
      .run(id, id, 'unused', 'user', 'active', now, now);
    database()
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(), id, '测试', 'preset:blue', 1, now, now);
  });
  return createSession(id, 'a'.repeat(32));
}
