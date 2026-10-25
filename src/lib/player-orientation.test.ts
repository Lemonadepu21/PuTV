import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindPlayerOrientation } from './player-orientation';

const dimensions = { clientWidth: 390, clientHeight: 844 };
function fixture(touch = true) {
  const classes = new Set<string>();
  const events = new Map<string, Set<(...args: unknown[]) => unknown>>();
  let native = false;
  let web = false;
  const art = {
    video: { videoWidth: 1920, videoHeight: 1080 }, isRotate: false, setting: { show: false },
    template: { $player: { classList: {
      contains: (name: string) => classes.has(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, active: boolean) => { if (active) classes.add(name); else classes.delete(name); },
    } } },
    get fullscreen() { return native; }, set fullscreen(value: boolean) { native = value; void emit('fullscreen', value); },
    get fullscreenWeb() { return web; }, set fullscreenWeb(value: boolean) { web = value; void emit('fullscreenWeb', value); },
    on: (key: string, fn: (...args: unknown[]) => unknown) => { if (!events.has(key)) events.set(key, new Set()); events.get(key)!.add(fn); },
    off: (key: string, fn: (...args: unknown[]) => unknown) => { events.get(key)?.delete(fn); },
    emit: (key: string) => { void emit(key); },
  };
  async function emit(key: string, ...args: unknown[]) { await Promise.all(Array.from(events.get(key) ?? []).map((fn) => fn(...args))); }
  const cleanup = bindPlayerOrientation(art as unknown as Artplayer, touch);
  return { art, emit, cleanup };
}
let lock: ReturnType<typeof vi.fn>;
let unlock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  dimensions.clientWidth = 390; dimensions.clientHeight = 844;
  lock = vi.fn().mockResolvedValue(undefined); unlock = vi.fn();
  vi.stubGlobal('document', { documentElement: dimensions, querySelector: () => null });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('screen', { orientation: { lock, unlock } });
});
afterEach(() => vi.unstubAllGlobals());

describe('安卓横屏与网页全屏降级', () => {
  it('竖屏锁定下请求横向，退出原生全屏后解锁', async () => {
    const { art, cleanup } = fixture();
    art.fullscreen = true; await Promise.resolve();
    expect(lock).toHaveBeenCalledWith('landscape');
    art.fullscreen = false;
    expect(unlock).toHaveBeenCalledOnce();
    expect(art.fullscreenWeb).toBe(false);
    cleanup();
  });

  it('方向锁定拒绝后退出原生全屏，切到横向网页全屏', async () => {
    lock.mockRejectedValue(new Error('not supported'));
    const { art, cleanup } = fixture();
    art.fullscreen = true; await Promise.resolve();
    expect(art.fullscreen).toBe(false);
    expect(art.fullscreenWeb).toBe(true);
    expect(art.isRotate).toBe(true);
    art.fullscreenWeb = false;
    expect(art.isRotate).toBe(false);
    cleanup();
  });

  it('HTTP 或浏览器没有方向接口时仍可 CSS 横向全屏', () => {
    vi.stubGlobal('screen', {});
    const { art, cleanup } = fixture();
    art.fullscreen = true;
    expect(art.fullscreenWeb).toBe(true);
    expect(art.isRotate).toBe(true);
    cleanup();
  });

  it('实体转成横屏后撤掉 CSS 旋转，旋回竖屏再启用', () => {
    const { art, cleanup } = fixture();
    art.fullscreenWeb = true; expect(art.isRotate).toBe(true);
    dimensions.clientWidth = 844; dimensions.clientHeight = 390;
    window.dispatchEvent(new Event('resize'));
    expect(art.isRotate).toBe(false);
    dimensions.clientWidth = 390; dimensions.clientHeight = 844;
    window.dispatchEvent(new Event('orientationchange'));
    expect(art.isRotate).toBe(true);
    cleanup(); expect(art.isRotate).toBe(false);
  });

  it('竖版视频与桌面均不强制横屏', () => {
    const first = fixture();
    first.art.video.videoWidth = 720; first.art.video.videoHeight = 1280;
    first.art.fullscreenWeb = true; first.art.fullscreen = true;
    expect(first.art.isRotate).toBe(false); expect(lock).not.toHaveBeenCalled();
    first.cleanup();
    const desktop = fixture(false); desktop.art.fullscreen = true;
    expect(lock).not.toHaveBeenCalled(); desktop.cleanup();
  });

  it('卸载时取消未完成的请求，后续拒绝不会重新打开全屏', async () => {
    let reject!: (error: Error) => void;
    lock.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const { art, cleanup } = fixture();
    art.fullscreen = true; cleanup();
    reject(new Error('cancelled')); await Promise.resolve();
    expect(unlock).toHaveBeenCalledOnce(); expect(art.fullscreenWeb).toBe(false);
  });

  it('原生全屏本身不支持时可使用网页全屏', async () => {
    const { art, emit, cleanup } = fixture();
    await emit('fullscreenError');
    expect(art.fullscreenWeb).toBe(true); expect(art.isRotate).toBe(true);
    cleanup();
  });

  it('Escape 先关闭设置，再退出横向网页全屏；桌面网页全屏也可退出', () => {
    const first = fixture();
    first.art.fullscreenWeb = true;
    first.art.setting.show = true;
    const escape = () => window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
    escape(); expect(first.art.setting.show).toBe(false); expect(first.art.fullscreenWeb).toBe(true);
    escape(); expect(first.art.fullscreenWeb).toBe(false); expect(first.art.isRotate).toBe(false);
    first.cleanup();
    const desktop = fixture(false); desktop.art.fullscreenWeb = true;
    escape(); expect(desktop.art.fullscreenWeb).toBe(false); desktop.cleanup();
  });

  it('等待锁定时用户已退出，异步失败不能再次弹出全屏', async () => {
    let reject!: (error: Error) => void;
    lock.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const { art, cleanup } = fixture();
    art.fullscreen = true; art.fullscreen = false;
    reject(new Error('cancelled')); await Promise.resolve();
    expect(art.fullscreenWeb).toBe(false);
    cleanup();
  });

});
