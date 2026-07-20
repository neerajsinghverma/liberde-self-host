/* Unit tests: analysis tag parsing, run segments, scheduler math, task CRUD. */
import assert from "node:assert";
import {
  extractRunBlocks,
  formatRunResult,
  parseRunResult,
} from "../lib/analysis";
import { splitContentSegments } from "../lib/artifact-shared";
import {
  computeNextRun,
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listDueTasks,
  updateScheduledTask,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("Analysis tool:");

ok("extractRunBlocks finds code", () => {
  const blocks = extractRunBlocks(
    `Let me check.\n<liberdeRun>\nconsole.log(2**10);\n</liberdeRun>`
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0], "console.log(2**10);");
});

ok("run result roundtrip", () => {
  const formatted = formatRunResult("1024");
  assert.equal(parseRunResult(formatted), "1024");
  assert.equal(parseRunResult("normal user text"), null);
});

ok("splitContentSegments yields run segments", () => {
  const segs = splitContentSegments(
    `Before\n<liberdeRun>console.log(1)</liberdeRun>\nAfter`
  );
  assert.deepEqual(
    segs.map((s) => s.kind),
    ["text", "run", "text"]
  );
  assert.equal(segs[1].runCode, "console.log(1)");
});

ok("streaming run tail detected", () => {
  const segs = splitContentSegments(`Checking\n<liberdeRun>\nconst x = [1,2`);
  assert.equal(segs[segs.length - 1].kind, "streaming-run");
});

ok("runs and artifacts coexist", () => {
  const segs = splitContentSegments(
    `<liberdeRun>console.log(1)</liberdeRun>\n<liberdeArtifact identifier="a" type="svg" title="A">\n<svg/>\n</liberdeArtifact>`
  );
  assert.deepEqual(
    segs.filter((s) => s.kind !== "text").map((s) => s.kind),
    ["run", "artifact"]
  );
});

console.log("Scheduler:");

ok("interval next_run is minutes ahead (min 5)", () => {
  const from = 1_000_000_000_000;
  assert.equal(computeNextRun("interval", 60, null, from), from + 3_600_000);
  assert.equal(computeNextRun("interval", 1, null, from), from + 300_000);
});

ok("daily next_run lands on HH:MM in the future", () => {
  const next = computeNextRun("daily", null, "09:30");
  const d = new Date(next);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
  assert.ok(next > Date.now());
  assert.ok(next < Date.now() + 24 * 3_600_000 + 60_000);
});

ok("task CRUD + due detection", () => {
  const task = createScheduledTask({
    name: "test-task",
    prompt: "say hi",
    schedule_kind: "interval",
    interval_minutes: 60,
    web_search: true,
  });
  try {
    assert.ok(getScheduledTask(task.id));
    assert.ok(!listDueTasks().some((t) => t.id === task.id), "not due yet");
    updateScheduledTask(task.id, { next_run: Date.now() - 1000 });
    assert.ok(listDueTasks().some((t) => t.id === task.id), "due after backdating");
    updateScheduledTask(task.id, { enabled: 0 });
    assert.ok(!listDueTasks().some((t) => t.id === task.id), "disabled tasks not due");
  } finally {
    deleteScheduledTask(task.id);
  }
  assert.equal(getScheduledTask(task.id), undefined);
});

console.log(`\n${passed} tests passed.`);
