import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessOverwrite,
  backupRotation,
  protectedWrite,
  SaveOverwriteDeclined,
  type SaveFs,
} from "../src/utils/protected-save.ts";

function memoryFs(): SaveFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir() {},
    async exists(path) {
      return files.has(path);
    },
    async read(path) {
      const value = files.get(path);
      if (value == null) throw new Error("missing");
      return value;
    },
    async write(path, contents) {
      files.set(path, contents);
    },
    async remove(path) {
      files.delete(path);
    },
    async move(from, to) {
      const value = files.get(from);
      if (value == null) throw new Error("missing");
      files.set(to, value);
      files.delete(from);
    },
    async copy(from, to) {
      const value = files.get(from);
      if (value == null) throw new Error("missing");
      files.set(to, value);
    },
    async list(directory) {
      const prefix = directory.endsWith("/") ? directory : `${directory}/`;
      const names: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length);
        if (!name.includes("/")) names.push(name);
      }
      return names;
    },
  };
}

describe("key save overwrite protection", () => {
  it("treats a missing file as a first write, including an empty list", () => {
    assert.deepEqual(assessOverwrite(null, "[]"), { ok: true });
    assert.deepEqual(assessOverwrite(null, ""), { ok: true });
  });

  it("requires confirmation before emptying or shrinking", () => {
    const empty = assessOverwrite('[{"id":"a"}]', "[]");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, "empty");
    const shrink = assessOverwrite("abcdef", "ab");
    assert.equal(shrink.ok, false);
    if (!shrink.ok) assert.equal(shrink.reason, "shrink");
    assert.deepEqual(assessOverwrite("[]", "[]"), { ok: true });
    assert.deepEqual(assessOverwrite("ab", "abcdef"), { ok: true });
  });

  it("rotates bak1 through bak5 and drops the oldest", () => {
    const names = ["key-manager.json", "key-manager.json.bak1", "key-manager.json.bak2", "key-manager.json.bak3", "key-manager.json.bak4", "key-manager.json.bak5"];
    const steps = backupRotation(names, "key-manager.json");
    assert.deepEqual(steps[0], { op: "delete", from: "key-manager.json.bak5" });
    assert.deepEqual(steps[1], { op: "move", from: "key-manager.json.bak4", to: "key-manager.json.bak5" });
    assert.deepEqual(steps.at(-1), { op: "move", from: "key-manager.json.bak1", to: "key-manager.json.bak2" });
    assert.equal(steps.some((step) => step.from === "key-manager.json"), false);
  });

  it("writes atomically and keeps five backups", async () => {
    const fs = memoryFs();
    const directory = "mem/";
    for (let n = 1; n <= 7; n++) {
      await protectedWrite({
        fs,
        directory,
        fileName: "key-manager.json",
        next: `v${n}`,
      });
    }
    assert.equal(fs.files.get("mem/key-manager.json"), "v7");
    assert.equal(fs.files.get("mem/key-manager.json.bak1"), "v6");
    assert.equal(fs.files.get("mem/key-manager.json.bak2"), "v5");
    assert.equal(fs.files.get("mem/key-manager.json.bak3"), "v4");
    assert.equal(fs.files.get("mem/key-manager.json.bak4"), "v3");
    assert.equal(fs.files.get("mem/key-manager.json.bak5"), "v2");
    assert.equal(fs.files.has("mem/key-manager.json.tmp"), false);
    assert.equal([...fs.files.values()].includes("v1"), false);
  });

  it("leaves the current file untouched when shrink is declined", async () => {
    const fs = memoryFs();
    await protectedWrite({
      fs,
      directory: "mem/",
      fileName: "key-manager.json",
      next: "abcdef",
    });
    await assert.rejects(
      () =>
        protectedWrite({
          fs,
          directory: "mem/",
          fileName: "key-manager.json",
          next: "ab",
          confirm: async () => false,
        }),
      (error: unknown) => error instanceof SaveOverwriteDeclined && error.reason === "shrink",
    );
    assert.equal(fs.files.get("mem/key-manager.json"), "abcdef");
    assert.equal(fs.files.has("mem/key-manager.json.bak1"), false);
  });

  it("replaces a smaller file only after confirmation and keeps the previous copy", async () => {
    const fs = memoryFs();
    await protectedWrite({
      fs,
      directory: "mem/",
      fileName: "key-manager.json",
      next: "abcdef",
    });
    await protectedWrite({
      fs,
      directory: "mem/",
      fileName: "key-manager.json",
      next: "ab",
      confirmShrink: true,
    });
    assert.equal(fs.files.get("mem/key-manager.json"), "ab");
    assert.equal(fs.files.get("mem/key-manager.json.bak1"), "abcdef");
  });
});
