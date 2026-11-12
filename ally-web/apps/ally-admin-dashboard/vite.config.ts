/// <reference types='vitest' />
import { build, defineConfig, loadEnv, type Plugin } from "vite";
import { transform } from "esbuild";
import { readFileSync } from "fs";
import react from "@vitejs/plugin-react";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";
import svgr from "vite-plugin-svgr";
import path from "path";

import { testResourceLimits } from "../../vitest.resource-limits";
// Get absolute paths
const projectRoot = __dirname;

/**
 * `/b/<slug>` is the bot page (b.html). The dev server and `vite preview` would otherwise answer it
 * with the dashboard's index.html. Deployed, the CDN does answer with index.html, and a script at
 * the top of it hands over to b.html in place.
 */
function botPageRoutes(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && /^\/b\/[^/?#]+\/?(\?.*)?$/.test(req.url)) req.url = "/b.html";
    next();
  };
  return {
    name: "bot-page-routes",
    configureServer: server => void server.middlewares.use(rewrite),
    configurePreviewServer: server => void server.middlewares.use(rewrite),
  };
}

/**
 * The website widget's loader (chunk 13), `/widget.js`. The dashboard's build also builds it (from
 * vite.widget.config.ts) so every deploy ships it; the dev server compiles it on request into the
 * same plain script, since a snippet's `<script>` can't load a module.
 */
function widgetBundle(): Plugin {
  let mode = "production";
  return {
    name: "ally-widget",
    configResolved: config => void (mode = config.mode),
    async closeBundle() {
      if (process.env.VITEST) return;
      await build({ configFile: path.resolve(projectRoot, "vite.widget.config.ts"), mode });
    },
    configureServer: server =>
      void server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/widget.js") return next();
        const env = loadEnv(server.config.mode, projectRoot, "VITE_");
        const { code } = await transform(
          readFileSync(path.resolve(projectRoot, "src/widget/loader.ts"), "utf8"),
          {
            loader: "ts",
            format: "iife",
            target: "es2019",
            define: {
              "import.meta.env.VITE_API_BASE_URL": JSON.stringify(env.VITE_API_BASE_URL ?? ""),
            },
          },
        );
        res.setHeader("Content-Type", "text/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(code);
      }),
  };
}

export default defineConfig(() => ({
  root: __dirname,
  // Production serves the admin app under app.helloally.ai/admin/ (set via
  // VITE_BASE_PATH in the release workflow); dev and other builds stay at /.
  base: process.env.VITE_BASE_PATH || "/",
  cacheDir: "../../node_modules/.vite/apps/ally-admin-dashboard",
  server: {
    port: 8081,
    host: true,
    hmr: {
      host: "localhost",
      port: 8081,
      clientPort: 8081,
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
    fs: {
      // allow accessing the monorepo root (e.g., ../../libs) inside container
      allow: ["..", "/app"],
    },
  },
  preview: {
    port: 4300,
    host: "localhost",
  },
  plugins: [
    react(),
    nxViteTsPaths(),
    nxCopyAssetsPlugin(["*.md"]),
    svgr(),
    botPageRoutes(),
    widgetBundle(),
  ],
  // Carbon v11 ships SCSS that triggers many Dart-Sass deprecation warnings.
  // quietDeps silences node_modules noise; silenceDeprecations keeps the
  // remaining (expected) Carbon warnings from failing the build.
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
        quietDeps: true,
        silenceDeprecations: ["global-builtin", "import", "color-functions", "legacy-js-api"],
      },
    },
  },
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  build: {
    outDir: "../../dist/apps/ally-admin-dashboard",
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Two pages: the dashboard, and the public bot page (/b/<slug>, chunk 12b), which shares no
      // code with the dashboard's entry so a visitor downloads only the page.
      input: {
        main: path.resolve(projectRoot, "index.html"),
        botPage: path.resolve(projectRoot, "b.html"),
      },
      output: {
        // Add content hashes to filenames for cache busting
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  optimizeDeps: {
    include: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
  },
  test: {
    // Bounded worker pool — this is the largest suite in the workspace and the
    // default (one fork per core) will exhaust a 16 GB machine. See
    // vitest.resource-limits.ts.
    ...testResourceLimits,
    testTimeout: 1800000,
    hookTimeout: 1800000,
    watch: false,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/apps/ally-admin-dashboard",
      provider: "v8" as const,
      exclude: [
        "node_modules/",
        "src/test-setup.ts",
        "**/*.d.ts",
        "**/*.config.{js,ts}",
        "**/coverage/**",
        "**/dist/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      ],
    },
    passWithNoTests: true,
    env: {
      VITE_API_BASE_URL: "http://localhost:3000",
    },
  },
  resolve: {
    alias: {
      "@src": path.resolve(projectRoot, "./src"),
      "@src/*": path.resolve(projectRoot, "./src/*"),
      "@components": path.resolve(projectRoot, "./src/components"),
      "@components/*": path.resolve(projectRoot, "./src/components/*"),
      "@icons": path.resolve(projectRoot, "./src/components/icons"),
      "@containers": path.resolve(projectRoot, "./src/containers"),
      "@containers/*": path.resolve(projectRoot, "./src/containers/*"),
      "@api": path.resolve(projectRoot, "./src/api"),
      "@api/*": path.resolve(projectRoot, "./src/api/*"),
      "@pages": path.resolve(projectRoot, "./src/pages"),
      "@pages/*": path.resolve(projectRoot, "./src/pages/*"),
      "@utils": path.resolve(projectRoot, "./src/utils"),
      "@utils/*": path.resolve(projectRoot, "./src/utils/*"),
      "@assets": path.resolve(projectRoot, "./src/assets"),
      "@assets/*": path.resolve(projectRoot, "./src/assets/*"),
      "@hooks": path.resolve(projectRoot, "./src/hooks"),
      "@hooks/*": path.resolve(projectRoot, "./src/hooks/*"),
      "@constants": path.resolve(projectRoot, "./src/constants"),
      "@constants/*": path.resolve(projectRoot, "./src/constants/*"),
      "@types": path.resolve(projectRoot, "./src/types"),
      "@types/*": path.resolve(projectRoot, "./src/types/*"),
      "@routes": path.resolve(projectRoot, "./src/routes"),
      "@routes/*": path.resolve(projectRoot, "./src/routes/*"),
      "@store": path.resolve(projectRoot, "./src/store"),
      "@store/*": path.resolve(projectRoot, "./src/store/*"),
      "@reducer": path.resolve(projectRoot, "./src/reducer"),
      "@reducer/*": path.resolve(projectRoot, "./src/reducer/*"),
      "@ally-ui-mono/ui-shared": path.resolve(projectRoot, "../../libs/ui-shared/src"),
      "@analytics": path.resolve(projectRoot, "../../libs/ui-shared/src/lib/analytics"),
      "@analytics/*": path.resolve(projectRoot, "../../libs/ui-shared/src/lib/analytics/*"),
      // Add any other aliases from tsconfig.base.json here
    },
  },
}));
