import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works at any URL, including a GitHub Pages
  // project site like /field-moisture-monitor/.
  base: "./",
});
