import { NextRequest } from "next/server";
import {
  canAccessProject,
  deleteProject,
  getProject,
  isProjectOwner,
  listConversations,
  listProjectFiles,
  listProjectMembers,
  updateProject,
} from "@/lib/db";
import { getRequestUserId, unauthorized } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const project = getProject(id);
  if (!project || !canAccessProject(id, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({
    ...project,
    files: listProjectFiles(id),
    // Each member sees their OWN chats within a shared project.
    conversations: listConversations(userId).filter((c) => c.project_id === id),
    members: listProjectMembers(id),
    isOwner: isProjectOwner(id, userId),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!getProject(id) || !isProjectOwner(id, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  updateProject(id, {
    ...(body.name != null ? { name: body.name } : {}),
    ...(body.instructions != null ? { instructions: body.instructions } : {}),
  });
  return Response.json(getProject(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getRequestUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!isProjectOwner(id, userId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  deleteProject(id);
  return Response.json({ ok: true });
}
