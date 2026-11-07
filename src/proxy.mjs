#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CatalogCache } from './lib/catalog-cache.js';
import { LazyMcpManager } from './lib/mcp-manager.js';
import { createSdkConnector } from './lib/sdk-connector.js';
import { serveProxy } from './lib/proxy.js';

if (!process.argv.includes('--experimental')) throw new Error('This proxy is opt-in. Pass --experimental and an explicit allowlisted config.');
const file = process.argv.find(x => x.startsWith('--config='))?.slice(9);
if (!file || !path.isAbsolute(file)) throw new Error('--config must be an absolute JSON file path');
const config = JSON.parse(await readFile(file, 'utf8'));
if (!path.isAbsolute(config.cacheDirectory ?? '')) throw new Error('cacheDirectory must be absolute');
const cache = new CatalogCache({ directory: config.cacheDirectory });
const manager = await new LazyMcpManager({ servers: config.servers, cache, connect: createSdkConnector(), createDefinition: () => { throw new Error('Proxy cannot register DSH native tools'); } }).initialize();
const server = await serveProxy({ manager, allowTools: config.allowTools });
let closing;
const close = () => closing ??= Promise.allSettled([server.close(), manager.close()]);
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
process.stdin.once('end', () => void close());
