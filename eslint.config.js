import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const templateImportGroup = [
  "**/templates/**",
  "../templates/*",
  "../templates/**",
  "../../templates/**",
  "../../templates/*",
];

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/engine/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: templateImportGroup,
              message:
                "src/engine must not import src/templates. Scenario templates sit outside the generic engine.",
            },
          ],
        },
      ],
    },
  },
);
