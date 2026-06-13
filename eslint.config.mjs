import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CommonJS one-off helper scripts (require() is intentional there).
    "scripts/**",
  ]),
  {
    rules: {
      // Reading localStorage/sessionStorage must happen after mount to stay
      // SSR/hydration-safe, so these setState-in-effect cases are intentional.
      // Keep visibility as a warning instead of failing the build.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
