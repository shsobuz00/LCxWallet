/**
 * Production entry point: runs the custody API and the built web app together.
 * The web server listens on $PORT (Hugging Face Spaces use 7860) and forwards /api to the custody API.
 */
const port = Number(process.env.PORT) || 3001;
const children = [
  Bun.spawn(['bun', 'run', 'server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] }),
  Bun.spawn(['bunx', 'vite', 'preview', '--host', '0.0.0.0', '--port', port, '--strictPort'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
]
const stop = () => children.forEach((child) => child.kill())
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
// If either process exits, stop the other and exit so the platform restarts the container.
await Promise.race(children.map((child) => child.exited))
stop()
process.exit(1)
