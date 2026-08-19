import { defineConfig } from "vite";

export default defineConfig({
  /* Every asset URL relative, so a build runs from wherever it is served —
     under a project path, or dropped into a page on another host. */
  base: "./",
  /*
   * The build goes to `docs/` and is committed, because Pages serves a folder
   * out of the branch: there is no build step on the other end, so the built
   * files are the deployment.
   */
  build: { outDir: "docs", emptyOutDir: true },
});
