import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLIENT_PORT, DAEMON_PORT } from './server/ports.ts'

// Source, not dist, for a sibling checkout: windease and delamin8r are
// co-designed with this repo, and each `main` points at a dist an edit to its
// src does not reach — a stale answer with no error. A clone with no siblings
// falls through to the published package in node_modules.
const sibling = (name: string, entries: Record<string, string>) => {
  const root = new URL(`../${name}/`, import.meta.url)
  if (!existsSync(fileURLToPath(root))) return {}
  return Object.fromEntries(
    Object.entries(entries).map(([from, to]) => [from, fileURLToPath(new URL(to, root))]),
  )
}

const daemon = `http://localhost:${DAEMON_PORT}`
const proxy = { target: daemon, ws: true, changeOrigin: false, xfwd: true }


export default defineConfig({
  plugins: [react()],
  // A literal, not a lookup on `import.meta.env`: the bundler has to see `false`
  // to drop the demo branch, and with it the daemon and forty pictures. An
  // env var read at runtime keeps all of it in the ordinary bundle.
  define: {
    __TRANSOM_DEMO__: JSON.stringify(process.env.VITE_TRANSOM_DEMO === '1'),
  },
  resolve: {
    // Sibling source imports react from its own tree, which may have no
    // node_modules — and two Reacts break hooks even where it does.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      // Every subpath, before the bare name: an alias matches as a prefix, so
      // labkit's `windease/react` would otherwise become `src/index.ts/react`.
      ...sibling('windease', {
        'windease/react': 'src/react/index.ts',
        'windease/nuts': 'src/nuts/index.ts',
        'windease/styles.css': 'src/react/styles.css',
        windease: 'src/index.ts',
      }),
      ...sibling('delamin8r', {
        'delamin8r/react': 'src/react.ts',
        delamin8r: 'src/index.ts',
      }),
    },
  },
  server: {
    // Its own port, not vite's 5173: this machine runs several vite projects
    // and whichever starts first takes 5173. strictPort then fails loudly
    // instead of drifting to a port nobody thinks to open.
    port: CLIENT_PORT,
    // Both address families. Left unset, node binds whatever the resolver
    // returns for `localhost` first — here `::1` — and the IPv4 loopback then
    // refuses, so the port is plainly listening and the page will not load.
    // `::` is the only value that answers on both: `0.0.0.0` is IPv4 only.
    host: '::',
    strictPort: true,
    proxy: { '/img': proxy, '/orig': proxy, '/page': proxy, '/api': proxy, '/ws': proxy },
  },
})
