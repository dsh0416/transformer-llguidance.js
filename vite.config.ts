import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), dts()],
  resolve: {
    alias: {
      // Provide env module for WASM instant crate timing functions
      env: resolve(__dirname, 'pkg/env.js'),
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['@huggingface/transformers'],
    },
  },
});

