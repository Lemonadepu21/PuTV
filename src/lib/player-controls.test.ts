import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Artplayer from 'artplayer';
import { bindPlayerControls } from './player-controls';

function fixture(touch = true) {
  const player = Object.assign(new EventTarget(), { contains: (): boolean => false, setAttribute: vi.fn() });
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let visible = false;
  const art = {
    template: { $player: player }, playing: true, setting: { show: false }, toggle: vi.fn(),
    controls: {
      get show() { return visible; },
      set show(value: boolean) { visible = value; emit('control', value); },
    },
    on: (key: string, fn: (...args: unknown[]) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    off: (key: string, fn: (...args: unknown[]) => void) => { listeners.get(key)?.delete(fn); },
  };
  function emit(key: string, ...args: unknown[]) { listeners.get(key)?.forEach((fn) => fn(...args)); }
  const cleanup = bindPlayerControls(art as unknown as Artplayer, touch);
  return { art, emit, player, cleanup };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', Object.assign(new EventTarget(), { activeElement: null }));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Artplayer.CONTROL_HIDE_TIME = 3000; });

describe('点播与直播共用控件计时', () => {
  it('触屏三秒后隐藏，再点按显示后重新计时', () => {
    const { art, cleanup } = fixture();
    vi.advanceTimersByTime(2999); expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1); expect(art.controls.show).toBe(false);
    art.controls.show = true;
    vi.advanceTimersByTime(2999); expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1); expect(art.controls.show).toBe(false);
    cleanup();
  });

  it('桌面仍按 800ms 隐藏', () => {
    const { art, cleanup } = fixture(false);
    vi.advanceTimersByTime(800); expect(art.controls.show).toBe(false);
    cleanup();
  });

  it('暂停与菜单期间不隐藏，继续播放或关闭菜单后再计时', () => {
    const { art, emit, cleanup } = fixture();
    art.playing = false; emit('video:pause');
    vi.advanceTimersByTime(10000); expect(art.controls.show).toBe(true);
    art.playing = true; emit('video:playing');
    art.setting.show = true; emit('setting', true);
    vi.advanceTimersByTime(10000); expect(art.controls.show).toBe(true);
    art.setting.show = false; emit('setting', false);
    vi.advanceTimersByTime(3000); expect(art.controls.show).toBe(false);
    cleanup();
  });

  it('拖动进度与手指按住期间不隐藏，松开后重新给三秒', () => {
    const { art, emit, player, cleanup } = fixture();
    player.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(10000); expect(art.controls.show).toBe(true);
    document.dispatchEvent(new Event('pointerup'));
    emit('video:seeking');
    vi.advanceTimersByTime(10000); expect(art.controls.show).toBe(true);
    emit('video:seeked');
    vi.advanceTimersByTime(2999); expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(1); expect(art.controls.show).toBe(false);
    cleanup();
  });

  it('触屏的合成鼠标移动不抢先显示，不产生 click toggle 闪隐', () => {
    const { art, player, cleanup } = fixture();
    vi.advanceTimersByTime(3000);
    const event = Object.assign(new Event('pointermove'), { pointerType: 'mouse' });
    player.dispatchEvent(event);
    expect(art.controls.show).toBe(false);
    art.controls.show = !art.controls.show;
    expect(art.controls.show).toBe(true);
    vi.advanceTimersByTime(2999); expect(art.controls.show).toBe(true);
    cleanup();
  });

  it('卸载清除计时和监听并恢复库默认值，下一播放器可重新计时', () => {
    const first = fixture(); first.cleanup();
    expect(Artplayer.CONTROL_HIDE_TIME).toBe(3000);
    vi.advanceTimersByTime(5000); expect(first.art.controls.show).toBe(true);
    const second = fixture(false);
    vi.advanceTimersByTime(800); expect(second.art.controls.show).toBe(false);
    second.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('键盘焦点在控件上时不隐藏，焦点离开后继续计时', () => {
    const { art, player, cleanup } = fixture();
    player.contains = () => true;
    Object.assign(document, { activeElement: { closest: () => ({}) } });
    player.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(5000); expect(art.controls.show).toBe(true);
    Object.assign(document, { activeElement: null });
    player.dispatchEvent(new Event('focusout'));
    vi.advanceTimersByTime(3000); expect(art.controls.show).toBe(false);
    cleanup();
  });


  it('播放器表面的 Enter / 空格可播放暂停，控件上的 Enter 留给原按钮', () => {
    const { art, player, cleanup } = fixture();
    player.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' }));
    expect(art.toggle).toHaveBeenCalledOnce();
    Object.assign(player, { closest: () => ({}) });
    player.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' }));
    expect(art.toggle).toHaveBeenCalledOnce();
    cleanup();
  });

});
