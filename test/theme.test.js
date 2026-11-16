import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const tokens = (block) =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
const root = tokens(css.match(/:root\s*\{([^}]+)\}/)[1]);
function luminance(hex) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function ratio(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test("normal text and control contrast for all four starter themes", () => {
  for (const id of [1, 4, 7, 252]) {
    const block = css.match(
      new RegExp(`body\\[data-starter="${id}"\\]\\s*\\{([^}]+)\\}`),
    );
    const t = { ...root, ...(block ? tokens(block[1]) : {}) };
    for (const [foreground, background] of [
      ["text", "surface"],
      ["muted", "surface"],
      ["muted", "surface-muted"],
      ["muted-on-canvas", "canvas"],
      ["text", "starter-accent"],
      ["text", "starter-tint"],
      ["starter-ink", "starter-tint"],
      ["starter-ink", "canvas"],
      ["focus-ink", "focus-tint"],
      ["surface", "focus-solid"],
      ["shared-ink", "shared-tint"],
      ["alert-ink", "alert-tint"],
      ["alert-ink", "surface"],
    ]) {
      const contrast = ratio(t[foreground], t[background]);
      assert(
        contrast >= 4.5,
        `${id}: ${foreground}/${background} ${contrast.toFixed(2)} < 4.5`,
      );
    }
    for (const [foreground, background] of [
      ["control-border", "surface"],
      ["control-border", "surface-muted"],
      ["focus-solid", "canvas"],
      ["focus-solid", "starter-tint"],
      ["starter-ink", "starter-accent"],
      ["shared-ink", "shared-tint"],
    ]) {
      const contrast = ratio(t[foreground], t[background]);
      assert(
        contrast >= 3,
        `${id}: control ${foreground}/${background} ${contrast.toFixed(2)} < 3`,
      );
    }
  }
});
