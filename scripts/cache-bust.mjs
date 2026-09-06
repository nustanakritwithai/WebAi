import { readFile, writeFile } from "node:fs/promises";

const version = String(process.argv[2] || "dev").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "dev";
const indexPath = new URL("../index.html", import.meta.url);
let html = await readFile(indexPath, "utf8");

html = html.replace(/(\b(?:href|src)=(["'])\.\/(?:styles\.css|semantic\.css|app\.js|workspace\.js)\2)(?:\?v=[^"']*)?/g, `$1?v=${version}`);
await writeFile(indexPath, html);
