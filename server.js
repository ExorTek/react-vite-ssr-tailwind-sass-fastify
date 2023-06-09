import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyMiddie from "@fastify/middie";
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const PORT = process.env.PORT || 5001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const absolutePath = (p) => path.resolve(__dirname, p);
const isDev = process.env.NODE_ENV === 'development';

export async function createServer(root = process.cwd(), hmrPort) {
    const indexProd = isDev ? '' : fs.readFileSync(absolutePath('dist/client/index.html'), 'utf-8')
    const server = fastify({logger: true});

    let vite;
    if (isDev) {
        vite = await (await import('vite')).createServer({
            root,
            logLevel: 'info',
            server: {
                middlewareMode: true,
                watch: {
                    usePolling: true,
                    interval: 100,
                },
                hmr: {
                    port: hmrPort,
                },
            },
            appType: 'custom',
        });

        await server.register(fastifyMiddie, {})
        server.use(vite.middlewares);
    } else {
        await server.register(fastifyCompress);
        await server.register(fastifyStatic, {
            root: absolutePath('dist/client'),
            prefix: '/'
        });
    }

    server.all(isDev ? '*' : '/:path*', async (request, reply) => {
        const url = request.raw.url;

        const template = isDev
            ? (await vite.transformIndexHtml(url, fs.readFileSync(absolutePath('index.html'), 'utf-8')))
            : indexProd;
        const render = isDev
            ? (await vite.ssrLoadModule('/src/entry-server.jsx')).render
            : (await import('./dist/server/entry-server.js')).render;

        const context = {};
        const appHtml = render(url, context);
        if (context.url) return reply.redirect(301, context.url);
        const html = template.replace(`<!--ssr-outlet-->`, appHtml);
        return reply.status(200).header('Content-Type', 'text/html').send(html);
    });

    server.setErrorHandler((error, request, reply) => {
        console.log(error)
        reply.send(
            {
                statusCode: 500,
                error: 'Internal Server Error',
                message: error.stack
            }
        )
    })
    return {server, vite, port: PORT};
}

createServer().then(({server, vite, port}) => {
    server.listen({
        port,
    }, (err, address) => {
        if (err) {
            server.log.error(err)
            process.exit(1)
        }
        server.log.info(`Server listening on ${address}`)
    })
})