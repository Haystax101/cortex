import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import mime from "mime-types";
import { BRAIN_DIR } from "./config.js";

const SKIP = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type TreeNode = {
  name: string;
  path: string; // relative to BRAIN_DIR
  type: "file" | "dir";
  size?: number;
  children?: TreeNode[];
};

// Resolves a client-supplied relative path, rejecting escapes from BRAIN_DIR.
function safeResolve(rel: string): string | null {
  const resolved = path.resolve(BRAIN_DIR, rel);
  if (resolved !== BRAIN_DIR && !resolved.startsWith(BRAIN_DIR + path.sep)) return null;
  return resolved;
}

async function buildTree(dir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name === ".gitkeep") continue;
    const full = path.join(dir, e.name);
    const relPath = path.relative(BRAIN_DIR, full);
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: relPath, type: "dir", children: await buildTree(full) });
    } else if (e.isFile()) {
      const stat = await fs.stat(full);
      nodes.push({ name: e.name, path: relPath, type: "file", size: stat.size });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return nodes;
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-() ]+/g, "_");
  return base || "upload";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

export const filesRouter = Router();

filesRouter.get("/tree", async (_req, res) => {
  res.json(await buildTree(BRAIN_DIR));
});

filesRouter.get("/content", async (req, res) => {
  const rel = String(req.query.path ?? "");
  const full = rel && safeResolve(rel);
  if (!full) return res.status(403).json({ error: "path outside brain" });

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return res.status(404).json({ error: "not found" });
  }
  if (!stat.isFile()) return res.status(400).json({ error: "not a file" });

  const mimeType = mime.lookup(full) || "application/octet-stream";
  const isText =
    mimeType.startsWith("text/") ||
    ["application/json", "application/javascript", "application/xml"].includes(mimeType) ||
    [".md", ".ts", ".tsx", ".jsx", ".yml", ".yaml", ".toml", ".env", ".gitignore"].includes(path.extname(full)) ||
    path.extname(full) === "";

  if (isText) {
    if (stat.size > MAX_TEXT_BYTES) return res.status(413).json({ error: "file too large to view" });
    const text = await fs.readFile(full, "utf8");
    res.json({ kind: "text", content: text, size: stat.size });
  } else {
    res.type(mimeType);
    res.sendFile(full);
  }
});

filesRouter.post("/upload", upload.array("files"), async (req, res) => {
  const destRel = typeof req.body?.dir === "string" && req.body.dir ? req.body.dir : "inbox";
  const destDir = safeResolve(destRel);
  if (!destDir) return res.status(403).json({ error: "destination outside brain" });
  await fs.mkdir(destDir, { recursive: true });

  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) return res.status(400).json({ error: "no files" });

  const saved: string[] = [];
  for (const f of files) {
    let name = sanitizeFilename(f.originalname);
    let target = path.join(destDir, name);
    for (let n = 1; ; n++) {
      try {
        await fs.access(target);
        const ext = path.extname(name);
        target = path.join(destDir, `${path.basename(name, ext)}-${n}${ext}`);
      } catch {
        break;
      }
    }
    await fs.writeFile(target, f.buffer);
    saved.push(path.relative(BRAIN_DIR, target));
  }
  res.json({ saved });
});
