import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'

// The UI is served by Vite; all /api/* calls are proxied to the agent
// server (Hono, see server/index.ts) so the browser sees one origin.
// The MDX plugin (enforce: 'pre') compiles blog posts in src/blog/*.mdx.
export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx({ providerImportSource: '@mdx-js/react', remarkPlugins: [remarkGfm] }) },
    react(),
  ],
  server: {
    port: 3005,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
