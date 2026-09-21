#!/usr/bin/env node
/** Builds a Claude Desktop bundle (.mcpb): a zip holding the compiled server,
 *  its runtime dependencies and a manifest, installable by double-click.
 *
 *   npm run build && npm run bundle
 *
 * Requires the mcpb CLI (npx @anthropic-ai/mcpb). */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const build = join(root, ".build-mcpb");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("dist/index.js is missing — run `npm run build` first.");
  process.exit(1);
}

rmSync(build, { recursive: true, force: true });
mkdirSync(join(build, "server"), { recursive: true });
cpSync(join(root, "dist"), join(build, "server"), { recursive: true });

for (const file of ["README.md", "LICENSE", "NOTICE"]) {
  cpSync(join(root, file), join(build, file));
}

// Runtime dependencies travel with the bundle; Claude Desktop ships Node but
// installs nothing. The keyring addon is native and platform-specific, so it is
// left out: without it the server falls back to a 0600 credentials file.
mkdirSync(join(build, "server", "node_modules"), { recursive: true });
for (const dependency of Object.keys(pkg.dependencies)) {
  const from = join(root, "node_modules", dependency);
  if (!existsSync(from)) {
    console.error(`Missing dependency ${dependency} — run \`npm install\` first.`);
    process.exit(1);
  }
  cpSync(from, join(build, "server", "node_modules", dependency), { recursive: true, dereference: true });
}
// Transitive dependencies of the SDK.
for (const entry of readdirSafe(join(root, "node_modules"))) {
  if (entry.startsWith(".") || entry === "@gpambrozio") continue;
  const target = join(build, "server", "node_modules", entry);
  if (!existsSync(target) && isRuntimeDependency(entry)) {
    cpSync(join(root, "node_modules", entry), target, { recursive: true, dereference: true });
  }
}

writeFileSync(
  join(build, "manifest.json"),
  `${JSON.stringify(
    {
      manifest_version: "0.3",
      name: "onshape-mcp",
      display_name: "Onshape CAD",
      version: pkg.version,
      description: pkg.description,
      long_description:
        "Create and edit parametric CAD in Onshape: documents and part studios, sketching, extrudes and " +
        "fillets, assemblies, drawings, measurement, renders and STL/STEP export. Signing in happens in your " +
        "browser the first time a tool needs it; credentials stay on your machine.",
      author: { name: pkg.author },
      repository: { type: "git", url: pkg.repository.url.replace(/^git\+/, "") },
      homepage: pkg.homepage,
      documentation: pkg.homepage,
      support: pkg.bugs.url,
      license: pkg.license,
      keywords: pkg.keywords,
      server: {
        type: "node",
        entry_point: "server/index.js",
        mcp_config: {
          command: "node",
          args: ["${__dirname}/server/index.js"],
          env: {
            ONSHAPE_MCP_OUTPUT_DIR: "${user_config.output_dir}",
          },
        },
      },
      user_config: {
        output_dir: {
          type: "directory",
          title: "Export folder",
          description: "Where exported STL/STEP files and renders are written.",
          required: false,
          default: "${HOME}/Downloads",
        },
      },
      compatibility: {
        runtimes: { node: ">=20.0.0" },
      },
    },
    null,
    2,
  )}\n`,
);

// npx is a .cmd shim on Windows, which execFileSync cannot launch directly.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["--yes", "@anthropic-ai/mcpb", "pack", build, join(root, `onshape-mcp-${pkg.version}.mcpb`)], {
  stdio: "inherit",
});
console.log(`\nBundle written to onshape-mcp-${pkg.version}.mcpb`);

function readdirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** The SDK pulls in a server framework we never start; only ship what the
 *  stdio path actually loads. */
function isRuntimeDependency(name) {
  return ["zod", "open", "ajv", "ajv-formats", "cross-spawn", "pkce-challenge", "json-schema-typed"].includes(name);
}
