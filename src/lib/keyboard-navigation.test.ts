import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableDirectionalNavigation, isBackKey, spatialTarget } from './keyboard-navigation';

const rect = (left: number, top: number, width = 100, height = 150) => ({ left, top, right: left + width, bottom: top + height });
afterEach(() => vi.unstubAllGlobals());

describe('遥控器空间导航', () => {
  const origin = rect(120, 200);
  const targets = [rect(0, 200), rect(240, 200), rect(120, 0), rect(120, 400)];
  it.each([['ArrowLeft', 0], ['ArrowRight', 1], ['ArrowUp', 2], ['ArrowDown', 3]] as const)('%s 选择对应邻居', (key, expected) => {
    expect(spatialTarget(origin, targets, key)).toBe(expected);
  });
  it('先选择对齐的卡片，不能跳向斜侧卡片', () => {
    expect(spatialTarget(origin, [rect(220, 0), rect(240, 200)], 'ArrowRight')).toBe(1);
  });
  it('最后一行缺列或不同行高仍能选择下一行最近项', () => {
    expect(spatialTarget(origin, [rect(0, 400), rect(240, 400)], 'ArrowDown')).toBe(0);
  });
  it('边界没有候选时不移动，非方向按键不接管', () => {
    expect(spatialTarget(origin, [rect(0, 200)], 'ArrowRight')).toBe(-1);
    expect(spatialTarget(origin, targets, 'Enter')).toBe(-1);
  });
  it.each(['Escape', 'BrowserBack', 'GoBack'])('%s 能关闭弹窗', (key) => {
    expect(isBackKey({ key, target: null })).toBe(true);
  });
  it('输入框内 Backspace 保留删除文字，其他位置可返回', () => {
    class FakeElement { constructor(private editing: boolean) {} closest() { return this.editing; } }
    vi.stubGlobal('Element', FakeElement);
    expect(isBackKey({ key: 'Backspace', target: new FakeElement(true) as unknown as EventTarget })).toBe(false);
    expect(isBackKey({ key: 'Backspace', target: new FakeElement(false) as unknown as EventTarget })).toBe(true);
  });
});


describe('方向导航事件边界（无浏览器界面）', () => {
  function setup(blocked = false, modal = false) {
    const origin = { closest: () => blocked, getBoundingClientRect: () => rect(0, 0) };
    const candidate = {
      tabIndex: 0, closest: () => false, getClientRects: () => [rect(0, 200)],
      getBoundingClientRect: () => rect(0, 200), focus: vi.fn(), scrollIntoView: vi.fn(),
    };
    const modalScope = { getClientRects: () => [rect(0, 0)], querySelectorAll: vi.fn(() => [candidate]) };
    const query = vi.fn((selector: string) => selector === '[aria-modal="true"]' ? (modal ? [modalScope] : []) : [candidate]);
    vi.stubGlobal('document', { activeElement: origin, body: {}, querySelectorAll: query, querySelector: () => null });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    const cleanup = enableDirectionalNavigation();
    const press = (extra = {}) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowDown', ...extra });
      window.dispatchEvent(event);
      return event;
    };
    return { candidate, modalScope, press, cleanup };
  }

  it('方向键移动焦点并滚入可见区，卸载后不再接管', () => {
    const { candidate, press, cleanup } = setup();
    expect(press().defaultPrevented).toBe(true);
    expect(candidate.focus).toHaveBeenCalledOnce(); expect(candidate.scrollIntoView).toHaveBeenCalledOnce();
    cleanup(); press(); expect(candidate.focus).toHaveBeenCalledOnce();
  });
  it('输入区域或播放器不接管方向键', () => {
    const { candidate, press, cleanup } = setup(true);
    expect(press().defaultPrevented).toBe(false); expect(candidate.focus).not.toHaveBeenCalled(); cleanup();
  });
  it('弹窗打开时只在弹窗内导航', () => {
    const { candidate, modalScope, press, cleanup } = setup(false, true);
    press(); expect(modalScope.querySelectorAll).toHaveBeenCalledOnce(); expect(candidate.focus).toHaveBeenCalledOnce(); cleanup();
  });
  it('组合键继续留给浏览器', () => {
    const { candidate, press, cleanup } = setup();
    press({ altKey: true }); press({ ctrlKey: true });
    expect(candidate.focus).not.toHaveBeenCalled(); cleanup();
  });
});
