// Runtime HTTP test of artifact list → publish → shared page → pin → remix → unpublish.
const BASE = "http://localhost:3210";
const CID = process.argv[2];
if (!CID) throw new Error("usage: node test-share-http.mjs <conversationId>");

const j = (r) => r.json();
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
};

const artifacts = await fetch(`${BASE}/api/conversations/${CID}/artifacts`).then(j);
check("artifacts list returns 1 artifact", artifacts.length === 1);
const art = artifacts[0];
check("has versions v1,v2", art.versions.map((v) => v.version).join(",") === "1,2");
check("v2 has the str-replace applied", art.versions[1].content.includes("},300);"));

const published = await fetch(`${BASE}/api/artifacts/${art.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publish: true, mode: "latest" }),
}).then(j);
check("publish returns share_id", Boolean(published.share_id));

const sid = published.share_id;
const sharedLatest = await fetch(`${BASE}/api/shared/${sid}`).then(j);
check("shared (latest) resolves to v2", sharedLatest.version === 2);

const pageRes = await fetch(`${BASE}/a/${sid}`);
const pageHtml = await pageRes.text();
check("shared page returns 200", pageRes.status === 200);
check("shared page contains title", pageHtml.includes("Pulse Demo"));

await fetch(`${BASE}/api/artifacts/${art.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publish: true, mode: "pinned", version: 1 }),
});
const sharedPinned = await fetch(`${BASE}/api/shared/${sid}`).then(j);
check("pinned share resolves to v1", sharedPinned.version === 1);
check("pinned content is the 900ms original", sharedPinned.content.includes("},900);"));

const remix = await fetch(`${BASE}/api/remix/${sid}`, { method: "POST" }).then(j);
check("remix creates a conversation", Boolean(remix.conversationId));
const remixArts = await fetch(
  `${BASE}/api/conversations/${remix.conversationId}/artifacts`
).then(j);
check("remixed conversation has the artifact at v1", remixArts.length === 1 && remixArts[0].versions.length === 1);
check("remix content matches pinned version", remixArts[0].versions[0].content.includes("},900);"));

await fetch(`${BASE}/api/artifacts/${art.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publish: false }),
});
const gone = await fetch(`${BASE}/api/shared/${sid}`);
check("unpublish makes share 404", gone.status === 404);

// cleanup remix conversation + demo conversation
await fetch(`${BASE}/api/conversations/${remix.conversationId}`, { method: "DELETE" });
await fetch(`${BASE}/api/conversations/${CID}`, { method: "DELETE" });
console.log(failures === 0 ? "\nAll share/remix tests passed." : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
