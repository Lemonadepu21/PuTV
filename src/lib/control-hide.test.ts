import { describe, expect, it } from 'vitest';
import Artplayer from 'artplayer';
import {
  ART_DEFAULT_CONTROL_HIDE_MS,
  DESKTOP_CONTROL_HIDE_MS,
  TOUCH_CONTROL_HIDE_MS,
} from './control-hide';

describe('控制栏隐藏策略', () => {
  it('恢复基准与 ArtPlayer 库默认一致（升级依赖后若默认值变化会在此暴露）', () => {
    expect(ART_DEFAULT_CONTROL_HIDE_MS).toBe(Artplayer.CONTROL_HIDE_TIME);
  });

  it('桌面收紧到 800ms，快于库默认', () => {
    expect(DESKTOP_CONTROL_HIDE_MS).toBe(800);
    expect(DESKTOP_CONTROL_HIDE_MS).toBeLessThan(ART_DEFAULT_CONTROL_HIDE_MS);
  });

  it('触屏给足三秒操作时间', () => {
    expect(TOUCH_CONTROL_HIDE_MS).toBe(3000);
    expect(TOUCH_CONTROL_HIDE_MS).toBeGreaterThan(DESKTOP_CONTROL_HIDE_MS);
  });
});
