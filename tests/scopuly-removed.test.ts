import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

describe("Scopuly is removed", () => {
  it("has no Scopuly screen, code, or assets", () => {
    for (const path of [
      "app/scopuly.tsx",
      "src/scopuly",
      "assets/brand/scopuly.png",
      "docs/SCOPULY_SEP7_PROPOSAL.md",
    ]) {
      assert.equal(existsSync(path), false, path);
    }
  });

  it("has no Scopuly mention in app code, native code, or config", () => {
    const hits = execSync(
      "git grep -i -l scopuly -- app src android app.json || true",
      { encoding: "utf8" },
    ).trim();
    assert.equal(hits, "");
  });

  it("keeps tap-to-pay SEP-7 pay links", () => {
    assert.equal(existsSync("src/tap-pay/sep7.ts"), true);
  });
});
