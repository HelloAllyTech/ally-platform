import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

export default [
  ...baseConfig,
  ...nx.configs["flat/react"],
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.js", "src/**/*.jsx"],
    ignores: ["dist/**", "build/**", "coverage/**", "**/*.config.*"],
    // Override or add rules here
    rules: {},
  },
  {
    // The public bot page (chunk 12b) is its own entry. It must not pull in the dashboard: its
    // barrels bring Redux, Carbon, PostHog and the admin API (whose 401 sends a visitor to /login).
    // Import by path from a module with no dashboard imports, as theme.ts does with brandColour.
    files: ["src/botPage/**/*.ts", "src/botPage/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@api",
                "@api/*",
                "@components",
                "@components/*",
                "@constants",
                "@constants/*",
                "@containers",
                "@containers/*",
                "@hooks",
                "@hooks/*",
                "@pages",
                "@pages/*",
                "@routes",
                "@routes/*",
                "@store",
                "@store/*",
                "@types",
                "@types/*",
                "@utils",
                "@utils/*",
                "@src*",
                "@ally-ui-mono/*",
                "@carbon/*",
                "@mui",
                "@mui/*",
                "@emotion/*",
                "react-redux",
                "@reduxjs/*",
                "posthog-js",
              ],
              message:
                "The bot page is a separate, small public bundle: don't import the dashboard. Import a self-contained module by relative path.",
            },
          ],
        },
      ],
    },
  },
];
