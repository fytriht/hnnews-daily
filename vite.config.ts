import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/hn-daily": {
        target: "https://www.daemonology.net",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
