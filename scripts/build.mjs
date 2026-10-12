// Builds the package in the current directory into dist/: esbuild for JavaScript, tsc for
// declarations. Run through each package's `build` script (cwd is the package directory).
//
// In the monorepo, package.json `exports` point at the TypeScript sources so nothing has to be
// built to develop. `publishConfig.exports` (applied by pnpm when packing) points at dist/.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = process.cwd()
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

/** Prefix of the scoped library packages; the part after it is the folder under packages/. */
const SCOPE = '@the-package-labs/idocs-'

/** What each package ships besides the compiled entries. */
const CONFIG = {
  '@the-package-labs/idocs-core': { entries: ['src/index.ts', 'src/node.ts', 'src/browser.ts'] },
  '@the-package-labs/idocs-react': { entries: ['src/index.ts'], copy: [['src/styles.css', 'dist/styles.css']] },
  '@the-package-labs/idocs-astro': {
    entries: ['src/index.ts'],
    copy: [
      ['src/Diagram.astro', 'dist/Diagram.astro'],
      ['src/Command.astro', 'dist/Command.astro'],
      ['src/starlight.css', 'dist/starlight.css'],
      ['src/virtual.d.ts', 'dist/virtual.d.ts'],
    ],
  },
  '@the-package-labs/idocs': { entries: ['src/index.ts', 'src/bin.ts'], bins: ['dist/bin.js'] },
  'create-idocs': { entries: ['src/index.ts', 'src/scaffold.ts'], bins: ['dist/index.js'], template: true },
}

const config = CONFIG[pkg.name]
if (!config) throw new Error(`No build config for ${pkg.name}`)

rmSync(join(dir, 'dist'), { recursive: true, force: true })
mkdirSync(join(dir, 'dist'), { recursive: true })

await build({
  absWorkingDir: dir,
  entryPoints: config.entries,
  outdir: 'dist',
  bundle: true,
  splitting: config.entries.length > 1,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  jsx: 'automatic',
  packages: 'external',
  external: ['node:*'],
  sourcemap: false,
  logLevel: 'warning',
})

// Entry points that are commands start with a hashbang; make it `node`, not the dev-time `tsx`.
for (const bin of config.bins ?? []) {
  const file = join(dir, bin)
  const text = readFileSync(file, 'utf8').replace(/^#!.*\n/, '')
  writeFileSync(file, `#!/usr/bin/env node\n${text}`)
  chmodSync(file, 0o755)
}

for (const [from, to] of config.copy ?? []) copyFileSync(join(dir, from), join(dir, to))

// npm includes a LICENSE only from the package folder, so each build copies the one in the root.
copyFileSync(join(root, 'LICENSE'), join(dir, 'LICENSE'))

if (config.template) {
  const { buildTemplate } = await import('./template.mjs')
  buildTemplate(join(dir, 'template'), { keepAliases: true })
}

declarations()
console.log(`built ${pkg.name}`)

/** .d.ts files via tsc. Workspace dependencies resolve to their built declarations, not sources. */
function declarations() {
  const paths = {}
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!dep.startsWith(SCOPE)) continue
    const depDir = join(root, 'packages', dep.slice(SCOPE.length))
    const depPkg = JSON.parse(readFileSync(join(depDir, 'package.json'), 'utf8'))
    for (const [sub, target] of Object.entries(depPkg.publishConfig?.exports ?? {})) {
      const types = typeof target === 'string' ? undefined : target.types
      if (types) paths[sub === '.' ? dep : `${dep}/${sub.slice(2)}`] = [join(depDir, types)]
    }
  }
  const tsconfig = join(dir, 'tsconfig.build.generated.json')
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: join(root, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: 'dist',
        rootDir: 'src',
        types: ['node'],
        typeRoots: [join(root, 'node_modules/@types')],
        paths,
      },
      include: ['src'],
      exclude: ['src/**/*.d.ts'],
    }),
  )
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', tsconfig], { cwd: dir, stdio: 'inherit' })
  } finally {
    rmSync(tsconfig, { force: true })
  }
}
