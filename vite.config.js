import { defineConfig } from "vite";

export default defineConfig({
  /* Every asset URL relative, so a build runs from wherever it is served —
     under a project path, or dropped into a page on another host. */
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
