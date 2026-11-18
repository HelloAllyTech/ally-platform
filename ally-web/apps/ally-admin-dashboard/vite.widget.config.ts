import path from "path";
import { defineConfig } from "vite";

/**
 * The website widget's loader (chunk 13): one small, unhashed `widget.js` beside the dashboard and
 * the bot page, since owners paste its URL into their own sites. Built on its own (`npm run
 * build:widget`, which CI size-checks) and by the dashboard's build (the `widgetBundle` plugin).
 */
export default defineConfig({
  root: __dirname,
  envDir: __dirname,
  publicDir: false,
  build: {
    outDir: "../../dist/apps/ally-admin-dashboard",
    emptyOutDir: false,
    target: "es2019",
    lib: {
      entry: path.resolve(__dirname, "src/widget/loader.ts"),
      name: "AllyWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
  },
});
