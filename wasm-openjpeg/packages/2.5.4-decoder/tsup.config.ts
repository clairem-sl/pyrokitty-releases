import { defineConfig } from "tsup";
import { cpSync } from "fs";

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2020',
  sourcemap: true,
  clean: true,
  dts: true,
  // Don't bundle the WASM JS — it uses a custom binary encoding that esbuild mangles
  noExternal: [],
  external: ['./openjpegjs.js'],
  onSuccess: async () => {
    cpSync('src/openjpegjs.js', 'dist/openjpegjs.js');
  },
});
