/* Team layer: shared project access + member management (state fully restored). */
import assert from "node:assert";
import { createUser } from "../lib/auth";
import {
  addProjectMember,
  canAccessProject,
  createProject,
  db,
  deleteProject,
  isProjectOwner,
  listProjectMembers,
  listProjects,
  removeProjectMember,
} from "../lib/db";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const cleanup: (() => void)[] = [];
try {
  const owner = createUser("owner@test.dev", "Owner", "password-own");
  const member = createUser("member@test.dev", "Member", "password-mem");
  for (const u of [owner, member]) {
    cleanup.push(() => {
      for (const t of ["settings", "conversations", "projects", "memories", "skills", "connectors", "scheduled_tasks", "api_keys", "shared_chats"]) {
        db.prepare(`UPDATE ${t} SET user_id = 'local' WHERE user_id = ?`).run(u.id);
      }
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM project_members WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    });
  }

  const project = createProject("Team Docs", "Shared instructions", owner.id);
  cleanup.push(() => deleteProject(project.id));

  ok("owner has access; stranger does not", () => {
    assert.ok(canAccessProject(project.id, owner.id));
    assert.ok(isProjectOwner(project.id, owner.id));
    assert.ok(!canAccessProject(project.id, member.id));
  });

  ok("sharing grants access without ownership", () => {
    addProjectMember(project.id, member.id);
    assert.ok(canAccessProject(project.id, member.id));
    assert.ok(!isProjectOwner(project.id, member.id));
    assert.ok(listProjects(member.id).some((p) => p.id === project.id));
    assert.equal(listProjectMembers(project.id)[0].email, "member@test.dev");
  });

  ok("removal revokes access", () => {
    removeProjectMember(project.id, member.id);
    assert.ok(!canAccessProject(project.id, member.id));
    assert.ok(!listProjects(member.id).some((p) => p.id === project.id));
  });
} finally {
  for (const fn of cleanup.reverse()) fn();
}

assert.equal(
  (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
  0,
  "cleanup must restore no-accounts mode"
);
console.log(`\n${passed} tests passed (instance restored).`);
