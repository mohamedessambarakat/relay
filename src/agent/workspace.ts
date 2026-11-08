import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);

export interface Workspace {
  dir: string;
  branch: string | null;
  kind: "folder" | "worktree" | "linked-folder";
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
    return path.resolve(stdout.trim()) === path.resolve(dir);
  } catch {
    return false;
  }
}

/**
 * Each ticket gets workspaces/<key>:
 * - linked git repo: a worktree on branch relay/<key> (main is never checked out or touched)
 * - linked plain folder: work happens in that folder
 * - nothing linked: an empty folder
 */
export async function prepareWorkspace(root: string, key: string, linkedPath: string | null): Promise<Workspace> {
  const dir = path.join(root, key);
  if (linkedPath) {
    if (!fs.existsSync(linkedPath)) throw new Error(`Linked folder doesn't exist: ${linkedPath}`);
    if (await isGitRepo(linkedPath)) {
      const branch = `relay/${key}`;
      if (fs.existsSync(path.join(dir, ".git"))) return { dir, branch, kind: "worktree" };
      fs.mkdirSync(root, { recursive: true });
      const { stdout } = await exec("git", ["-C", linkedPath, "branch", "--list", branch]);
      const args = stdout.trim() ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir];
      await exec("git", ["-C", linkedPath, ...args]);
      return { dir, branch, kind: "worktree" };
    }
    return { dir: linkedPath, branch: null, kind: "linked-folder" };
  }
  fs.mkdirSync(dir, { recursive: true });
  return { dir, branch: null, kind: "folder" };
}
