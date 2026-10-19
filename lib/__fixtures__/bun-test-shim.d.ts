// Minimal types for `bun:test`, so `tsc` / `next build` can type-check the repo's *.test.ts files
// without adding @types/bun. Matchers are typed loosely on purpose (any matcher name is allowed).
// If @types/bun is ever added as a dev dependency, delete this file.
declare module 'bun:test' {
  interface Matchers {
    not: Matchers;
    resolves: Matchers;
    rejects: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toHaveLength(length: number): void;
    toMatchObject(expected: object): void;
    toThrow(expected?: unknown): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [matcher: string]: any;
  }
  type Fn = () => void | Promise<void>;
  interface TestFn {
    (name: string, fn: Fn, timeoutMs?: number): void;
    skip(name: string, fn: Fn): void;
    only(name: string, fn: Fn): void;
    todo(name: string, fn?: Fn): void;
    skipIf(condition: boolean): (name: string, fn: Fn) => void;
    if(condition: boolean): (name: string, fn: Fn) => void;
  }
  export const expect: (actual: unknown) => Matchers;
  export const test: TestFn;
  export const it: TestFn;
  export const describe: TestFn;
  export const beforeAll: (fn: Fn) => void;
  export const afterAll: (fn: Fn) => void;
  export const beforeEach: (fn: Fn) => void;
  export const afterEach: (fn: Fn) => void;
  export const mock: { module(path: string, factory: () => unknown): void };
}
