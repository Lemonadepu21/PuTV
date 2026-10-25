import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createAccount } from '../src/server/identity.ts';
import { closeDatabase } from '../src/server/database.ts';

try {
  let username: string, password: string;
  if (process.stdin.isTTY) {
    let hidden = false;
    const output = new Writable({
      write(chunk, encoding, done) {
        if (!hidden) process.stdout.write(chunk, encoding);
        done();
      },
    });
    const input = createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    username = await input.question('管理员用户名：');
    process.stdout.write('管理员密码（至少 8 位，输入不回显）：');
    hidden = true;
    password = await input.question('');
    hidden = false;
    process.stdout.write('\n');
    input.close();
  } else {
    let content = '';
    for await (const chunk of process.stdin) {
      content += String(chunk);
      if (content.length > 4096) throw new Error('输入过长');
    }
    const data = JSON.parse(content);
    username = data.username;
    password = data.password;
  }
  await createAccount(username, password, 'admin');
  console.log('管理员创建成功');
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? '请输入有效的用户名和密码 JSON'
      : error instanceof Error
        ? error.message
        : '初始化失败'
  );
  process.exitCode = 1;
} finally {
  closeDatabase();
}
