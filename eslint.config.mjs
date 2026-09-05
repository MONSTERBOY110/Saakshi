import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  {
    // AudioWorklet processors run in the AudioWorkletGlobalScope, not the window.
    files: ["public/worklets/**/*.js"],
    languageOptions: {
      globals: {
        registerProcessor: "readonly",
        sampleRate: "readonly",
        AudioWorkletProcessor: "readonly",
      },
    },
  },
];

export default eslintConfig;
