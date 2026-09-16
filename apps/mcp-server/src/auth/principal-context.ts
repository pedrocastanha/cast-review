import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpPrincipal } from './introspect-client';

const principalStorage = new AsyncLocalStorage<McpPrincipal>();

export function runWithPrincipal<T>(principal: McpPrincipal, work: () => T): T {
  return principalStorage.run(principal, work);
}

export function currentPrincipal(): McpPrincipal {
  const principal = principalStorage.getStore();
  if (!principal) {
    throw new Error('No MCP principal in scope');
  }
  return principal;
}
