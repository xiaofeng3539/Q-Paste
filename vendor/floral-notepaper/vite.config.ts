import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => ({
  root: projectDir,
  base: "./",
  plugins: [react(), tailwindcss()],
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(projectDir, "src/electron/core.ts"),
      "@tauri-apps/api/event": path.resolve(projectDir, "src/electron/event.ts"),
      "@tauri-apps/api/app": path.resolve(projectDir, "src/electron/app.ts"),
      "@tauri-apps/api/window": path.resolve(projectDir, "src/electron/window.ts"),
      "@tauri-apps/api/dpi": path.resolve(projectDir, "src/electron/dpi.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(projectDir, "src/electron/dialog.ts"),
      "@tauri-apps/plugin-clipboard-manager": path.resolve(projectDir, "src/electron/clipboard.ts"),
      "@tauri-apps/plugin-opener": path.resolve(projectDir, "src/electron/opener.ts"),
    },
  },
  clearScreen: false,
  build: {
    outDir: path.resolve(projectDir, "../../dist/floral"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 把体积最大的第三方库拆成独立 chunk：markdown 渲染链（懒加载后
        // 仅预览时才拉取）与基础 vendor 分离，提升窗口间磁盘缓存复用
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) {
            return "vendor-i18n";
          }
          if (id.includes("katex")) {
            return "vendor-katex";
          }
          return undefined;
        },
      },
    },
  },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: {
    setupFiles: ["./src/locales/test-setup.ts"],
  },
}));
