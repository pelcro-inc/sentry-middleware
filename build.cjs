const {build} = require('esbuild');

const entryfile = "src/index.ts";

const sharedBuildConfiguration = {
    bundle: true,
    entryPoints: [entryfile],
    minify: true,
    sourcemap: true,
    target: ["esnext", "node14.0.0"]
}

// build ESM
// build({
//     ...sharedBuildConfiguration,
//     format: "esm",
//     outfile: "./dist/index.esm.js",
// })

// build CJS
build({
    ...sharedBuildConfiguration,
    format: "cjs",
    platform: "node",
    outfile: "./dist/index.cjs.js",
})