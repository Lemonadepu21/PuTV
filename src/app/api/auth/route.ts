import { NextResponse } from 'next/server';
export { GET } from './me/route';
export { POST as DELETE } from './logout/route';
/** 旧站点密码入口不再签发任何会话。 */
export async function POST() {
  return NextResponse.json({ error: '请使用账号登录或注册' }, { status: 410 });
}
