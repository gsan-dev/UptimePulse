import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  {
    rules: {
      // Permite descartar variables a propósito (ej. desestructurar y omitir
      // un campo) prefijándolas con "_", en vez de tener que usarlas igualmente.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Los diálogos nativos del navegador no están disponibles en todos los
    // entornos donde se abre la app (navegador integrado de VS Code,
    // webviews, iframes con sandbox, Chrome con "impedir que esta página
    // cree más diálogos"): ahí confirm() devuelve false sin mostrar nada y
    // la acción se cancela en silencio. Eso rompió el borrado de canales.
    // Usar useConfirm() de context/ConfirmContext.tsx en su lugar.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Usa useConfirm() (context/ConfirmContext.tsx): confirm() no funciona en todos los entornos." },
        { name: "alert", message: "Usa showToast() (context/ToastContext.tsx): alert() no funciona en todos los entornos." },
        { name: "prompt", message: "Usa un formulario o un diálogo propio: prompt() no funciona en todos los entornos." },
      ],
    },
  }
);
