/* Memory v2: model-editable memory tools + id-addressed context. */
import assert from "node:assert";
import {
  buildMemoryContext,
  execMemoryTool,
  isMemoryTool,
  MEMORY_TOOL_DEFS,
} from "../lib/memory";
import { deleteMemory, listMemories } from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const before = new Set(listMemories().map((m) => m.id));
const mine = () => listMemories().filter((m) => !before.has(m.id));

try {
  ok("memory tool defs are valid function defs", () => {
    assert.equal(MEMORY_TOOL_DEFS.length, 3);
    for (const t of MEMORY_TOOL_DEFS) {
      assert.match(t.function.name, /^memory_/);
      assert.ok(isMemoryTool(t.function.name));
    }
    assert.ok(!isMemoryTool("web_search"));
  });

  ok("memory_save creates and returns a handle", () => {
    const out = execMemoryTool(
      "memory_save",
      JSON.stringify({ content: "The user's favorite tea is oolong" })
    );
    assert.match(out, /^Saved memory \[[0-9a-f]{8}\]/);
    assert.ok(mine().some((m) => m.content.includes("oolong")));
  });

  ok("context lists memories with 8-char ids", () => {
    const ctx = buildMemoryContext();
    const record = mine()[0];
    assert.ok(ctx.includes(`[${record.id.slice(0, 8)}]`));
    assert.ok(ctx.includes("oolong"));
  });

  ok("memory_update edits by id prefix", () => {
    const record = mine()[0];
    const out = execMemoryTool(
      "memory_update",
      JSON.stringify({ id: record.id.slice(0, 8), content: "The user's favorite tea is sencha" })
    );
    assert.match(out, /^Updated memory/);
    assert.ok(listMemories().some((m) => m.content.includes("sencha")));
    assert.ok(!listMemories().some((m) => m.content.includes("oolong")));
  });

  ok("memory_forget deletes by id prefix", () => {
    const record = mine()[0];
    const out = execMemoryTool("memory_forget", JSON.stringify({ id: record.id.slice(0, 8) }));
    assert.match(out, /^Forgot memory/);
    assert.equal(mine().length, 0);
  });

  ok("unknown id and bad JSON fail gracefully", () => {
    assert.match(execMemoryTool("memory_forget", JSON.stringify({ id: "zzzzzzzz" })), /^Error/);
    assert.match(execMemoryTool("memory_save", "{bad"), /^Error/);
    assert.match(execMemoryTool("memory_save", JSON.stringify({ content: "" })), /^Error/);
  });
} finally {
  for (const m of mine()) deleteMemory(m.id);
}

console.log(`\n${passed} tests passed.`);
