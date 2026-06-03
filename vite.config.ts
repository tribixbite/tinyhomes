import { defineConfig } from "vite";

// Custom apex domain (sortsafe.com) serves from root, so base = "/".
export default defineConfig({
  base: "/",
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
