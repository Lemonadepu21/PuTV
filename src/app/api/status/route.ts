import { NextResponse } from 'next/server';
import { database } from '@/server/database';
import { identityFromRequest } from '@/lib/auth';
import { identityResponse, responseError } from '@/server/http';
import { registrationEnabled } from '@/server/identity';
import { getEnvSources } from '@/lib/env-sources';
import { getEnvLiveSources } from '@/lib/env-live-sources';
import { getEnvSubscriptions } from '@/lib/env-subscriptions';
import { getEnvRecommendSource } from '@/lib/env-recommend-source';
import { getEnvImageMode } from '@/lib/env-image-mode';

export const runtime = 'nodejs';

/** 站点状态与已认证身份；登录后下发预置采集站、直播源和订阅 */
export async function GET(req: Request) {
  try {
    database();
    const identity = identityFromRequest(req);
    const verified = Boolean(identity);
    const passwordRequired = true;
    return NextResponse.json(
      {
        passwordRequired,
        ...identityResponse(identity),
        registrationEnabled:
          registrationEnabled() && Boolean(process.env.PASSWORD),
        // 构建时由 next.config.ts 从 package.json 注入
        version: process.env.APP_VERSION || 'dev',
        // 部署者通过 DEFAULT_SOURCES 预置的采集站
        defaultSources: verified ? getEnvSources() : [],
        // 部署者通过 DEFAULT_LIVE_SOURCES 预置的直播源（M3U 订阅）
        defaultLiveSources: verified ? getEnvLiveSources() : [],
        // 部署者通过 DEFAULT_SUBSCRIPTIONS 预置的 SourceList 订阅链接
        defaultSubscriptions: verified ? getEnvSubscriptions() : [],
        // 部署者通过 DEFAULT_RECOMMEND_SOURCE 指定的首页推荐数据源默认值（未配置时为 null）
        defaultRecommendSource: getEnvRecommendSource() ?? null,
        // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时为 null）
        defaultImageMode: getEnvImageMode() ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return responseError(error);
  }
}
