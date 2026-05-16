import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage"],
        },
      },
    },
  },
  server: { port: 3000 },
  optimizeDeps: {
    include: ["react", "react-dom", "firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage", "firebase/messaging"],
  },
});