import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindMediaMetadata } from './media-metadata';

class MockImage {
  static latest: MockImage;
  src = '';
  referrerPolicy = '';
  naturalWidth = 600;
  naturalHeight = 900;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { MockImage.latest = this; }
  removeAttribute() { this.src = ''; }
}
class Metadata {
  title = '';
  artist = '';
  artwork: MediaImage[] = [];
  constructor(init: MediaMetadataInit) { Object.assign(this, init); }
}
const base = 'https://putv.example/watch';
let session: { metadata: Metadata | null };
beforeEach(() => {
  session = { metadata: null };
  vi.stubGlobal('navigator', { mediaSession: session });
  vi.stubGlobal('MediaMetadata', Metadata);
  vi.stubGlobal('Image', MockImage);
});
afterEach(() => vi.unstubAllGlobals());

describe('系统媒体卡片', () => {
  it('标题与当前集数一致，加载封面前使用站点图标', () => {
    const cleanup = bindMediaMetadata('剧名 第2集', ['https://image.example/poster.jpg'], base);
    expect(session.metadata?.title).toBe('剧名 第2集');
    expect(session.metadata?.artist).toBe('PuTV');
    expect(session.metadata?.artwork[0].src).toBe('https://putv.example/icons/icon-512.png');
    MockImage.latest.onload?.();
    expect(session.metadata?.artwork).toEqual([{ src: 'https://image.example/poster.jpg', sizes: '600x900' }]);
    cleanup(); expect(session.metadata).toBeNull();
  });
  it('复用图片降级链，代理地址转换为当前站点的绝对 URL', () => {
    bindMediaMetadata('电影', ['https://image.example/poster.jpg', '/api/proxy?url=poster'], base);
    MockImage.latest.onerror?.();
    expect(MockImage.latest.src).toBe('https://putv.example/api/proxy?url=poster');
    MockImage.latest.onload?.();
    expect(session.metadata?.artwork[0].src).toBe(MockImage.latest.src);
  });
  it('没有封面或全部失败时保留品牌图标，不显示上一部影片', () => {
    bindMediaMetadata('新影片', [], base);
    expect(MockImage.latest.src).toBe('');
    const cleanup = bindMediaMetadata('另一部', ['https://bad.example/cover'], base);
    MockImage.latest.onerror?.();
    expect(session.metadata?.artwork[0].src).toContain('/icons/icon-512.png');
    cleanup(); expect(session.metadata?.title).toBe('新影片');
  });
  it('换页后取消旧图片回调，不覆盖其他媒体卡片', () => {
    const cleanup = bindMediaMetadata('旧影片', ['https://image.example/old.jpg'], base);
    const callback = MockImage.latest.onload;
    const other = new Metadata({ title: '其他播放' });
    session.metadata = other;
    callback?.(); cleanup(); callback?.();
    expect(session.metadata).toBe(other);
    expect(other.artwork).toEqual([]);
    expect(MockImage.latest.onload).toBeNull();
    expect(MockImage.latest.src).toBe('');
  });
  it('跳过无效 URL、非图片网络协议和带凭据地址', () => {
    bindMediaMetadata('影片', ['javascript:alert(1)', 'data:image/png,abc', 'https://user:password@image.example', 'http://[', '/cover.webp'], base);
    expect(MockImage.latest.src).toBe('https://putv.example/cover.webp');
    expect(MockImage.latest.referrerPolicy).toBe('no-referrer');
  });
  it('不支持系统媒体信息的浏览器保持原有播放行为', () => {
    vi.stubGlobal('navigator', {});
    expect(() => bindMediaMetadata('影片', [], base)()).not.toThrow();
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal('MediaMetadata', undefined);
    expect(() => bindMediaMetadata('影片', [], base)()).not.toThrow();
    expect(session.metadata).toBeNull();
  });
});
