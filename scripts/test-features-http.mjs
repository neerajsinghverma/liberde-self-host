// HTTP tests for the feature batch against a running server.
const BASE = "http://localhost:3210";
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};
const j = (r) => r.json();

// settings roundtrip
await fetch(`${BASE}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    aboutUser: "HTTP test user",
    styleInstructions: "Be terse.",
    memoryEnabled: true,
    imageModel: "google/gemini-2.5-flash-image",
  }),
});
const settings = await fetch(`${BASE}/api/settings`).then(j);
check("settings roundtrip (aboutUser)", settings.aboutUser === "HTTP test user");
check("settings roundtrip (imageModel)", settings.imageModel === "google/gemini-2.5-flash-image");
check("settings roundtrip (memoryEnabled)", settings.memoryEnabled === true);

// memories CRUD
const mem = await fetch(`${BASE}/api/memories`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "HTTP test memory" }),
}).then(j);
let memories = await fetch(`${BASE}/api/memories`).then(j);
check("memory created and listed", memories.some((m) => m.id === mem.id));
await fetch(`${BASE}/api/memories?id=${mem.id}`, { method: "DELETE" });
memories = await fetch(`${BASE}/api/memories`).then(j);
check("memory deleted", !memories.some((m) => m.id === mem.id));

// temp conversation hidden from history
const temp = await fetch(`${BASE}/api/conversations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ temp: true }),
}).then(j);
const list = await fetch(`${BASE}/api/conversations`).then(j);
check("temp chat hidden from list", !list.some((c) => c.id === temp.id));
const tempGet = await fetch(`${BASE}/api/conversations/${temp.id}`);
check("temp chat still directly accessible", tempGet.status === 200);
const shareTemp = await fetch(`${BASE}/api/conversations/${temp.id}/share`, { method: "POST" });
check("temp chat cannot be shared", shareTemp.status === 400);

// full-text search via API (seeded conversation passed as argv)
const seededId = process.argv[2];
if (seededId) {
  const hits = await fetch(`${BASE}/api/conversations?q=quetzalcoatl`).then(j);
  check("full-text search API finds seeded message", hits.some((c) => c.id === seededId));

  // share + public page
  const { shareId } = await fetch(`${BASE}/api/conversations/${seededId}/share`, {
    method: "POST",
  }).then(j);
  const page = await fetch(`${BASE}/share/${shareId}`);
  const html = await page.text();
  check("shared chat page returns 200", page.status === 200);
  check("shared chat page contains message text", html.includes("quetzalcoatl"));
  await fetch(`${BASE}/api/conversations/${seededId}/share`, { method: "DELETE" });
  const gone = await fetch(`${BASE}/share/${shareId}`);
  const goneHtml = await gone.text();
  check("unshared page shows not-found", goneHtml.includes("Chat not found"));
  await fetch(`${BASE}/api/conversations/${seededId}`, { method: "DELETE" });
}

// image models endpoint (live OpenRouter call)
const imgModels = await fetch(`${BASE}/api/models/image`).then(j);
check(
  "image models endpoint returns model ids",
  Array.isArray(imgModels) && imgModels.length > 0
);
if (Array.isArray(imgModels)) {
  console.log(`   (${imgModels.length} image-capable models, e.g. ${imgModels.slice(0, 3).join(", ")})`);
}

// cleanup
await fetch(`${BASE}/api/conversations/${temp.id}`, { method: "DELETE" });
await fetch(`${BASE}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ aboutUser: "", styleInstructions: "" }),
});

console.log(failures === 0 ? "\nAll feature HTTP tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
