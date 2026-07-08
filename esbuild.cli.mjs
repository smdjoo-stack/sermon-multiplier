import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  external: [...builtins],
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/cli.mjs",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
