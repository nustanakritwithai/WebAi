import { readFile, writeFile } from "node:fs/promises";

const requestedVersion = process.argv[2] || process.env.GITHUB_SHA || "dev";
const version = String(requestedVersion).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "dev";
const indexPath = new URL("../index.html", import.meta.url);
let html = await readFile(indexPath, "utf8");

html = html.replace(/(<meta\s+name=["']webai-release["']\s+content=["'])[^"']*(["'])/i, `$1${version}$2`);
html = html.replace(/(\b(?:href|src)=)(["'])(\.\/(?:styles\.css|semantic\.css|app\.js|workspace\.js))(?:\?[^"']*)?\2/g, `$1$2$3?v=${version}$2`);
await writeFile(indexPath, html);
