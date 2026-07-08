import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  external: [...builtinModules],
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/cli.mjs",
  minify: prod,
  loader: { ".html": "text", ".md": "text" },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
