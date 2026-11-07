import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Reuse the Host's exact DSH module instances; never install duplicate scope/services. */
export async function loadHostRuntime() {
  const anchors = [];
  if (process.resourcesPath) anchors.push(path.join(process.resourcesPath, 'app.asar', 'dsh', 'package.json'));
  if (process.argv[1] && path.isAbsolute(process.argv[1])) anchors.push(process.argv[1]);
  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      const names = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-subprocess'];
      const resolved = names.map(name => require.resolve(name));
      const [schema, llm, mcp, scope, subprocess] = await Promise.all(resolved.map(file => import(pathToFileURL(file).href)));
      return { configSchema: schema.default, createUserMessage: llm.createUserMessage,
        createMcpToolDefinition: mcp.createMcpToolDefinition, scopeChainOf: scope.scopeChainOf,
        scrubbedParentEnv: subprocess.scrubbedParentEnv };
    } catch (error) {
      if (anchor === anchors.at(-1)) throw new Error(`Cannot resolve the installed DSH runtime modules: ${error.message}`);
    }
  }
  throw new Error('No installed DSH module anchor is available');
}
