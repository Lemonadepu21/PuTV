import 'server-only';
import sharp from 'sharp';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { database, databasePath, transaction } from './database.ts';
import { ownedProfile, IdentityError } from './identity.ts';

export const AVATAR_LIMIT = 2 * 1024 * 1024;
let processing = 0;
const imageName = /^[a-f0-9]{48}\.webp$/;
function directory() {
  return join(dirname(databasePath()), 'avatars');
}
export async function cleanAvatar(avatar: string) {
  const file = avatar.startsWith('upload:') ? avatar.slice(7) : '';
  if (
    imageName.test(file) &&
    !database().prepare('SELECT id FROM profiles WHERE avatar=?').get(avatar)
  )
    await unlink(join(directory(), file)).catch(() => {});
}
export async function saveAvatar(
  accountId: string,
  profileId: string,
  data: Buffer,
  crop: { zoom: number; x: number; y: number }
) {
  ownedProfile(accountId, profileId);
  if (!data.length || data.length > AVATAR_LIMIT)
    throw new IdentityError('图片最大为 2MB', 413);
  if (
    ![crop.zoom, crop.x, crop.y].every(Number.isFinite) ||
    crop.zoom < 1 ||
    crop.zoom > 4 ||
    crop.x < 0 ||
    crop.x > 1 ||
    crop.y < 0 ||
    crop.y > 1
  )
    throw new IdentityError('裁剪参数无效');
  if (processing >= 2) throw new IdentityError('头像处理繁忙，请稍后重试', 429);
  processing++;
  try {
    let output: Buffer;
    try {
      const meta = await sharp(data, { limitInputPixels: 16000000 }).metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(meta.format || '') ||
        (meta.pages || 1) !== 1
      )
        throw new Error('format');
      const decoded = await sharp(data, { limitInputPixels: 16000000 })
        .rotate()
        .toBuffer({ resolveWithObject: true });
      const { width, height } = decoded.info;
      const side = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
      output = await sharp(decoded.data, { limitInputPixels: 16000000 })
        .extract({
          left: Math.floor((width - side) * crop.x),
          top: Math.floor((height - side) * crop.y),
          width: side,
          height: side,
        })
        .resize(256, 256)
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new IdentityError(
        '无法解码图片，仅支持静态 JPG、PNG、WebP（最多 1600 万像素）'
      );
    }
    const file = `${randomBytes(24).toString('hex')}.webp`;
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    // 文件先落盘再事务更新，失败时清理；并发请求只清理它替换掉的旧文件。
    await writeFile(join(directory(), file), output, {
      flag: 'wx',
      mode: 0o600,
    });
    let old = '';
    try {
      transaction(() => {
        old = ownedProfile(accountId, profileId).avatar;
        database()
          .prepare(
            'UPDATE profiles SET avatar=?,updated_at=? WHERE id=? AND account_id=?'
          )
          .run(`upload:${file}`, Date.now(), profileId, accountId);
      });
    } catch (error) {
      await unlink(join(directory(), file)).catch(() => {});
      throw error;
    }
    await cleanAvatar(old);
    return ownedProfile(accountId, profileId);
  } finally {
    processing--;
  }
}
export async function readAvatar(accountId: string, profileId: string) {
  const profile = ownedProfile(accountId, profileId),
    name = profile.avatar.slice(7);
  if (!profile.avatar.startsWith('upload:') || !imageName.test(name))
    throw new IdentityError('头像不存在', 404);
  return readFile(join(directory(), name));
}
export async function avatarForm(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new IdentityError('需要图片表单');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (!reader) throw new IdentityError('图片为空');
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > AVATAR_LIMIT + 16384) {
      await reader.cancel();
      throw new IdentityError('图片最大为 2MB', 413);
    }
    chunks.push(chunk.value);
  }
  const body = Buffer.concat(chunks);
  let form: FormData;
  try {
    form = await new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': req.headers.get('content-type')! },
      body,
    }).formData();
  } catch {
    throw new IdentityError('图片表单无效');
  }
  const file = form.get('file');
  if (
    !(file instanceof File) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  )
    throw new IdentityError('请选择 JPG、PNG 或 WebP 图片');
  const crop = {
    zoom: Number(form.get('zoom') || 1),
    x: Number(form.get('x') || 0.5),
    y: Number(form.get('y') || 0.5),
  };
  return { data: Buffer.from(await file.arrayBuffer()), crop };
}
