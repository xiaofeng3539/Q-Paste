import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              input: {
                main: path.resolve(__dirname, 'electron/main.ts'),
                'database-worker': path.resolve(__dirname, 'electron/database-worker.ts'),
              },
              external: ['node:sqlite', 'koffi', 'electron-updater'],
              output: {
                format: 'cjs',
                entryFileNames: (entry) => entry.name === 'main' ? 'main.js' : '[name].cjs',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
