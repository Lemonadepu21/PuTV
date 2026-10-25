// 在 Linux Docker 中验证真实运行镜像；只使用临时测试数据和独立命名卷。
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const image = process.env.DOCKER_TEST_IMAGE || 'putv:v2-test';
const port = Number(process.env.DOCKER_TEST_PORT || 8083);
const name = `putv-identity-test-${process.pid}`,
  volume = `${name}-data`;
const origin = `http://127.0.0.1:${port}`,
  password = randomBytes(20).toString('hex');
const command = (args, input) =>
  spawnSync('docker', args, { input, encoding: 'utf8' });
function docker(args, input) {
  const result = command(args, input);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
let cookie = '',
  device = '';
async function call(
  path,
  method = 'GET',
  body,
  session = cookie,
  expected = 200,
  requestOrigin = origin
) {
  const headers = { origin: requestOrigin, cookie: session };
  if (body !== undefined && !(body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${response.status} ${await response.clone().text()}`
  );
  return response;
}
async function login(username, secret = password) {
  const response = await call(
    '/api/auth/login',
    'POST',
    { username, password: secret },
    ''
  );
  const cookies = response.headers.getSetCookie();
  const result = cookies.find((c) => c.startsWith('putv_session='));
  assert(result?.includes('HttpOnly'));
  assert(result?.includes('SameSite=lax'));
  cookie = result.split(';')[0];
  device = cookies.find((c) => c.startsWith('putv_device=')).split(';')[0];
  return cookie;
}
async function start(
  invite = 'test-invite',
  registration = 'true',
  readonly = false
) {
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--network=host',
    '-e',
    `PORT=${port}`,
    '-e',
    `APP_ORIGIN=${origin}`,
    '-e',
    'ALLOW_INSECURE_HTTP=true',
    '-e',
    'LIVE_ALLOW_PRIVATE=1',
    '-e',
    `PASSWORD=${invite}`,
    '-e',
    `REGISTRATION_ENABLED=${registration}`,
    '-e',
    `SQLITE_PATH=${readonly ? '/app/forbidden.sqlite' : '/app/data/putv.sqlite'}`,
    '-v',
    `${volume}:/app/data`,
    image,
  ];
  docker(args);
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(origin + '/api/status');
      if (response.status === (readonly ? 503 : 200)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('生产容器启动失败');
}
function remove() {
  command(['rm', '-f', name]);
}
try {
  await start();
  assert.equal(docker(['exec', name, 'id', '-u']), '1001');
  const init = JSON.stringify({ username: 'administrator', password });
  assert.match(
    docker(['exec', '-i', name, 'npm', 'run', 'admin:create'], init),
    /管理员创建成功/
  );
  assert.notEqual(
    command(['exec', '-i', name, 'npm', 'run', 'admin:create'], init).status,
    0
  );
  await call(
    '/api/auth/register',
    'POST',
    {
      username: 'alice',
      password,
      confirmPassword: password,
      invitation: 'wrong',
    },
    '',
    403
  );
  const registered = await call(
    '/api/auth/register',
    'POST',
    {
      username: 'alice',
      password,
      confirmPassword: password,
      invitation: 'test-invite',
    },
    ''
  );
  cookie = registered.headers
    .getSetCookie()
    .find((c) => c.startsWith('putv_session='))
    .split(';')[0];
  let me = await (await call('/api/auth/me')).json();
  const account = me.account.id,
    first = me.profile.id;
  assert.equal(me.account.role, 'user');
  await call(
    '/api/auth/register',
    'POST',
    {
      username: 'ALICE',
      password,
      confirmPassword: password,
      invitation: 'test-invite',
    },
    '',
    409
  );
  await call('/api/admin/accounts', 'GET', undefined, cookie, 403);
  await call(
    '/api/profiles',
    'POST',
    { name: 'spoofed', accountId: 'other' },
    cookie,
    400
  );
  await call('/api/profiles', 'POST', { name: '家庭成员' }, cookie, 201);
  let profiles = await (await call('/api/profiles')).json();
  const second = profiles.profiles.find((p) => p.id !== first).id;
  await call(
    '/api/profiles/select',
    'POST',
    { profileId: second },
    cookie,
    403,
    'https://evil.example'
  );
  await call('/api/profiles/select', 'POST', { profileId: second });
  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#315DC7' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('file', new File([png], 'test.png', { type: 'image/png' }));
  form.set('zoom', '1.5');
  form.set('x', '0.3');
  form.set('y', '0.5');
  await call(`/api/profiles/${first}/avatar`, 'POST', form);
  const photo = Buffer.from(
    await (await call(`/api/profiles/${first}/avatar`)).arrayBuffer()
  );
  const meta = await sharp(photo).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.format, 'webp');
  const alice = cookie;
  await call(
    '/api/auth/register',
    'POST',
    {
      username: 'bobby',
      password,
      confirmPassword: password,
      invitation: 'test-invite',
    },
    ''
  );
  await login('bobby');
  await call(`/api/profiles/${first}/avatar`, 'GET', undefined, cookie, 403);
  await call(`/api/profiles/${first}`, 'PATCH', { name: 'evil' }, cookie, 403);
  await call('/api/profiles/select', 'POST', { profileId: first }, cookie, 403);
  cookie = alice;
  docker([
    'exec',
    '-d',
    name,
    'node',
    '--input-type=module',
    '-e',
    `
    import http from 'node:http';
    const time=ms=>new Date(ms).toISOString().replace(/[-:T]/g,'').slice(0,14)+' +0000';
    http.createServer((req,res)=>{
      if(req.url==='/list.m3u')res.end('#EXTM3U\\n#EXTINF:-1 tvg-id="demo",Fixture\\nhttp://127.0.0.1:8084/index.m3u8\\n');
      else if(req.url==='/guide.xml')res.end('<tv><programme channel="demo" start="'+time(Date.now()-60000)+'" stop="'+time(Date.now()+3600000)+'"><title>Fixture</title></programme></tv>');
      else if(req.url==='/index.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U\\n#EXT-X-TARGETDURATION:1\\n#EXTINF:1,\\nsegment.ts\\n#EXT-X-ENDLIST\\n');}
      else res.end(Buffer.alloc(188,71));
    }).listen(8084,'127.0.0.1');
  `,
  ]);
  docker([
    'exec',
    name,
    'node',
    '--input-type=module',
    '-e',
    `for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:8084/list.m3u');process.exit(0);}catch{await new Promise(resolve=>setTimeout(resolve,100));}}process.exit(1);`,
  ]);
  const upstream = 'http://127.0.0.1:8084';
  const playlist = await (
    await call(
      '/api/live/playlist?url=' + encodeURIComponent(upstream + '/list.m3u')
    )
  ).json();
  assert.equal(playlist.channels.length, 1);
  const guide = await (
    await call(
      '/api/live/epg?channel=demo&url=' +
        encodeURIComponent(upstream + '/guide.xml')
    )
  ).json();
  assert.equal(guide.current.title, 'Fixture');
  const manifest = await (
    await call(
      '/api/live/stream?url=' + encodeURIComponent(upstream + '/index.m3u8')
    )
  ).text();
  assert(manifest.startsWith('#EXTM3U'));
  assert(manifest.includes('/api/live/stream?'));
  const segment = manifest
    .split('\n')
    .find((line) => line.startsWith('/api/live/stream?'));
  assert.equal((await (await call(segment)).arrayBuffer()).byteLength, 188);
  await call(
    '/api/search',
    'POST',
    { wd: 'test', sources: [], filterAdult: true },
    cookie,
    400
  );
  await call('/api/auth/logout', 'POST');
  await call('/api/profiles', 'GET', undefined, cookie, 401);
  await call(
    '/api/profiles',
    'GET',
    undefined,
    'ltv_session=999999999999.fake',
    401
  );
  await login('alice');
  const persistent = cookie;
  docker(['restart', name]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await call('/api/auth/me', 'GET', undefined, persistent);
  remove();
  await start('rotated-invite', 'false');
  me = await (await call('/api/auth/me', 'GET', undefined, persistent)).json();
  assert.equal(me.account.id, account);
  cookie = persistent;
  await call(`/api/profiles/${first}/avatar`);
  await call('/api/auth/register', 'POST', {}, '', 403);
  await login('alice');
  const aliceAgain = cookie;
  await login('administrator');
  await call('/api/admin/accounts');
  await call(`/api/admin/accounts/${account}`, 'PATCH', { status: 'disabled' });
  await call('/api/profiles', 'GET', undefined, aliceAgain, 401);
  await call(
    '/api/auth/login',
    'POST',
    { username: 'alice', password },
    '',
    401
  );
  await call(`/api/admin/accounts/${account}`, 'PATCH', { status: 'active' });
  await call('/api/profiles', 'GET', undefined, aliceAgain, 401);
  const replacement = randomBytes(20).toString('hex');
  await call(`/api/admin/accounts/${account}/reset-password`, 'POST', {
    password: replacement,
  });
  await call(
    '/api/auth/login',
    'POST',
    { username: 'alice', password },
    '',
    401
  );
  await login('alice', replacement);
  const resetSession = cookie;
  await call('/api/auth/change-password', 'POST', {
    currentPassword: replacement,
    password,
  });
  await login('administrator');
  await call('/api/profiles', 'GET', undefined, resetSession);
  await call(`/api/admin/accounts/${account}/revoke-sessions`, 'POST');
  await call('/api/profiles', 'GET', undefined, resetSession, 401);
  const adminIdentity=await(await call('/api/auth/me')).json();
  await call(`/api/admin/accounts/${adminIdentity.account.id}/revoke-sessions`,'POST');
  await call('/api/admin/accounts','GET',undefined,cookie,401);
  remove();
  await start('test-invite', 'true', true);
  const error = await (
    await call('/api/status', 'GET', undefined, '', 503)
  ).json();
  assert.match(error.error, /持久化目录/);
  console.log(
    'PASS: 生产镜像非 root、管理员 CLI、注册/登录/CSRF/隔离/撤销、头像处理、重启/重建持久化、邀请码轮换、关闭注册、IPTV/EPG/HLS 及写权限失败'
  );
} finally {
  remove();
  command(['volume', 'rm', volume]);
}
