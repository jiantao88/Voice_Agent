import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'nodejs-whisper',
        'ws',
        'dotenv',
        'openai',
        '@tavily/core',
        'pdf-parse',
        'sherpa-onnx-node',
        'better-sqlite3',
        'sqlite-vec',
        /^sqlite-vec-/,
      ],
    },
  },
});
