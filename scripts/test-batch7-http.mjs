// HTTP tests: unified search, artifact user-edit versions, agent route validation.
const BASE = "http://localhost:3210";
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};
const j = (r) => r.json();

// unified search
const empty = await fetch(`${BASE}/api/search?q=`).then(j);
check("empty search returns empty groups", empty.conversations.length === 0 && empty.projects.length === 0);

const project = await fetch(`${BASE}/api/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Xylophone Research Initiative" }),
}).then(j);
const hits = await fetch(`${BASE}/api/search?q=xylophone`).then(j);
check("unified search finds projects by name", hits.projects.some((p) => p.id === project.id));
await fetch(`${BASE}/api/projects/${project.id}`, { method: "DELETE" });

// artifact user-edit endpoint (seed via tsx-created conversation is heavier; use remix-free direct flow)
// Create a conversation + artifact through the seed script path is not available over HTTP,
// so test validation paths here:
const noArt = await fetch(`${BASE}/api/artifacts/nonexistent/versions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "x" }),
});
check("editing unknown artifact 404s", noArt.status === 404);

// agent route validation
const conv = await fetch(`${BASE}/api/conversations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
}).then(j);
const noKey = await fetch(`${BASE}/api/agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId: conv.id, goal: "test" }),
});
check("agent without key returns 400", noKey.status === 400);
const badConv = await fetch(`${BASE}/api/agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId: "nope", goal: "test" }),
});
check("agent with bad conversation 404s", badConv.status === 404);
const noGoal = await fetch(`${BASE}/api/agent`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId: conv.id, goal: "" }),
});
check("agent without goal 400s", noGoal.status === 400);
await fetch(`${BASE}/api/conversations/${conv.id}`, { method: "DELETE" });

console.log(failures === 0 ? "\nAll batch-7 HTTP tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
