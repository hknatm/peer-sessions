import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve the installed host, never install SDK copies into the harness npm tree.
export async function loadHostRuntime() {
	const cli = fs.realpathSync(execFileSync("/bin/sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim());
	let root = path.dirname(cli);
	while (root !== path.dirname(root)) {
		const manifest = path.join(root, "package.json");
		if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") break;
		root = path.dirname(root);
	}
	const entry = path.join(root, "dist/bundle/index.js");
	if (!fs.existsSync(entry)) throw new Error("Health checks require an npm-installed Pi with a bundled SDK");
	const require = createRequire(path.join(root, "package.json"));
	const { createJiti } = require("jiti");
	const alias = { "@earendil-works/pi-coding-agent": entry, typebox: require.resolve("typebox") };
	for (const name of ["pi-ai", "pi-tui", "pi-agent-core"]) {
		alias[`@earendil-works/${name}`] = path.join(root, "node_modules/@earendil-works", name, "dist", name === "pi-ai" ? "compat.js" : "index.js");
	}
	return { cli, sdk: await import(pathToFileURL(entry)), jiti: createJiti(import.meta.url, { alias, moduleCache: false }) };
}
