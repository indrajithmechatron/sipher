import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://192.168.1.35:8888",
      "/command": "http://192.168.1.35:8888",
    },
  },
  preview: {
    proxy: {
      "/api": "http://192.168.1.35:8888",
      "/command": "http://192.168.1.35:8888",
    },
  },
});
