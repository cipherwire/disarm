import vm from 'node:vm';
import { makeStubs } from '../utils/stubs.js';

/**
 * Execute a script inside a hardened context and collect the objects the
 * caller asks for (`roots`). Returns { dump, ran } :  `ran` is false when the
 * script threw before finishing, in which case the dump may be partial.
 */
export function runAndCollect(code, roots, timeoutMs = 3000) {
  const sandbox = { ...makeStubs(), __unmask_dump: {} };
  vm.createContext(sandbox);

  let ran = true;
  try {
    vm.runInContext(code, sandbox, { timeout: timeoutMs, displayErrors: true });
  } catch {
    ran = false;
  }

  const dump = {};
  for (const root of roots) {
    try {
      const value = vm.runInContext(`__unmask_dump[${JSON.stringify(root)}]`, sandbox, { timeout: 500 });
      dump[root] = value ?? null;
    } catch {
      dump[root] = null;
    }
  }
  return { dump, ran };
}
