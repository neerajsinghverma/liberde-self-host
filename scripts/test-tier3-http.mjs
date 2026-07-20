// HTTP smoke tests for scheduled tasks + research validation.
const BASE = "http://localhost:3210";
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};
const j = (r) => r.json();

// tasks CRUD over HTTP
const task = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "http-test-task",
    prompt: "say hello",
    schedule_kind: "daily",
    daily_time: "07:45",
    web_search: false,
  }),
}).then(j);
check("task created with next_run in the future", task.next_run > Date.now());
check("daily time honored", task.daily_time === "07:45");

let list = await fetch(`${BASE}/api/tasks`).then(j);
check("task appears in list", list.some((t) => t.id === task.id));

const paused = await fetch(`${BASE}/api/tasks`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: task.id, enabled: false }),
}).then(j);
check("task pausable", paused.enabled === 0);

// run-now without an API key should fail cleanly (502 with message)
const run = await fetch(`${BASE}/api/tasks/${task.id}/run`, { method: "POST" });
check("run-now without key returns 502", run.status === 502);
const runBody = await run.json();
check("run-now error mentions key", String(runBody.error).includes("API key"));

await fetch(`${BASE}/api/tasks?id=${task.id}`, { method: "DELETE" });
list = await fetch(`${BASE}/api/tasks`).then(j);
check("task deleted", !list.some((t) => t.id === task.id));

// research route validation
const conv = await fetch(`${BASE}/api/conversations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
}).then(j);
const noKey = await fetch(`${BASE}/api/research`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId: conv.id, query: "test" }),
});
check("research without key returns 400", noKey.status === 400);
const badConv = await fetch(`${BASE}/api/research`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId: "nope", query: "test" }),
});
check("research with bad conversation returns 404", badConv.status === 404);
await fetch(`${BASE}/api/conversations/${conv.id}`, { method: "DELETE" });

// scheduler boot check: instrumentation should have logged startup
console.log(failures === 0 ? "\nAll tier-3 HTTP tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
