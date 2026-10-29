import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

/**
 * Serves one build folder at a time on a free port, the way the deployed
 * site would: a file when there is one, else the app shell. Switching the
 * folder is a new deploy at the same origin, which `vite preview` can't do.
 * Every response is uncached, so the browser sees a switch on its next
 * request, as it would `/sw.js` behind public/_headers.
 */
export class SwitchableSite {
  readonly url: string
  #root: string
  readonly #server: Server

  private constructor(server: Server, url: string, root: string) {
    this.#server = server
    this.url = url
    this.#root = root
  }

  static async start(root: string): Promise<SwitchableSite> {
    let site: SwitchableSite | undefined
    const server = createServer((request, response) => {
      void site?.respond(request.url ?? '/', response)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('The test site has no port.')
    site = new SwitchableSite(server, `http://127.0.0.1:${address.port}`, root)
    return site
  }

  /** Deploys `root`: every request from now on is served from it. */
  serve(root: string): void {
    this.#root = root
  }

  close(): Promise<void> {
    this.#server.closeAllConnections()
    return new Promise((resolve) => this.#server.close(() => resolve()))
  }

  private async respond(url: string, response: import('node:http').ServerResponse): Promise<void> {
    const path = normalize(decodeURIComponent(new URL(url, this.url).pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = path === '/' || extname(path) === '' ? '/index.html' : path
    try {
      const body = await readFile(join(this.#root, file))
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    }
  }
}
