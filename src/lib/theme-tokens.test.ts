import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');

function luminance(rgb: number[]) {
  const linear = rgb.map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// 按 WCAG 公式检查真实样式中的正文、输入提示与主按钮文字。
describe.each([':root', '.dark'])('%s 主题文字对比度', (selector) => {
  const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  const tokens = Object.fromEntries(
    [...block.matchAll(/--c-([\w-]+):\s*([\d ]+);/g)].map((m) => [
      m[1], m[2].trim().split(/\s+/).map(Number),
    ])
  );

  it.each([
    ['content', 'page'], ['content', 'surface'], ['content', 'surface-raised'],
    ['muted', 'page'], ['muted', 'surface'], ['muted', 'surface-raised'], ['faint', 'surface-raised'],
    ['success', 'surface'], ['success', 'surface-raised'],
    ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ])('%s / %s 达到 AA 正文字体对比度', (foreground, background) => {
    const [low, high] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => a - b);
    expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['accent', 'danger', 'warning', 'success', 'info'])('%s 标签文字在实际半透明底色上达到 AA', (name) => {
    const opacity = Number(block.match(/--c-state-tint:\s*([\d.]+)/)![1]);
    const foreground = tokens[name];
    const background = tokens['surface-raised'].map((value, index) => value * (1 - opacity) + foreground[index] * opacity);
    const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('警告标签悬停后仍达到 AA', () => {
    const opacity = Number(block.match(/--c-state-tint:\s*([\d.]+)/)![1]) + .05;
    const foreground = tokens.warning;
    const background = tokens['surface-raised'].map((value, index) => value * (1 - opacity) + foreground[index] * opacity);
    const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
