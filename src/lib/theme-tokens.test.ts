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
    ['muted', 'page'], ['muted', 'surface'], ['faint', 'surface-raised'],
    ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ])('%s / %s 达到 AA 正文字体对比度', (foreground, background) => {
    const [low, high] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => a - b);
    expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
