const {build} = require('esbuild');

const entryfile = "src/index.ts";

const sharedBuildConfiguration = {
    bundle: true,
    entryPoints: [entryfile],
    minify: true,
    sourcemap: true,
    target: ["esnext", "node22.0.0"],
    external: ["@sentry/aws-serverless", "@sentry/node"],
    keepNames: true,
    treeShaking: true
}

// build ESM
build({
    ...sharedBuildConfiguration,
    format: "esm",
    outfile: "./dist/index.esm.js",
}).catch(() => process.exit(1));

// build CJS
build({
    ...sharedBuildConfiguration,
    format: "cjs",
    platform: "node",
    outfile: "./dist/index.cjs.js",
}).catch(() => process.exit(1));