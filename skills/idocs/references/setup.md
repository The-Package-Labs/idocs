# Setting up idocs

idocs renders diagrams inside an **Astro** site (usually with **Starlight** for the docs chrome). Use the project's package manager; examples use pnpm.

## What is on npm

| Package | Role |
|---|---|
| `create-idocs` | `npm create idocs@latest`: scaffolds a new site. |
| `@the-package-labs/idocs` | The CLI: `idocs check`, `list`, `schema`, `icons search`, `new`. |
| `@the-package-labs/idocs-astro` | The Astro integration and the `<Diagram>` component. |
| `@the-package-labs/idocs-react` | The interactive diagram component (a dependency of the integration). |
| `@the-package-labs/idocs-core` | Schema, compiler and layout (a dependency of the others). |

The source is `https://github.com/The-Package-Labs/idocs`. If an install fails with "not found", check `npm view @the-package-labs/idocs-core version`: it should print a version. A company registry mirror may simply not have the `@packagelab` scope yet.

## Start a new site

```sh
npm create idocs@latest my-docs
cd my-docs
pnpm install
pnpm dev                 # http://localhost:4321
```

This creates an Astro + Starlight project with an example diagram (`diagrams/shop`), three pages, a GitHub Pages workflow, and this skill. The folder must be empty or not exist. Edit `diagrams/shop/diagram.yaml` and the page reloads.

## Add idocs to an existing Astro + Starlight site

1. **Install.**
   ```sh
   pnpm add @the-package-labs/idocs-astro @the-package-labs/idocs-react @astrojs/react react react-dom
   pnpm add -D @the-package-labs/idocs
   ```
   On pnpm 10 or later, allow the build scripts it asks about by adding to `pnpm-workspace.yaml`:
   ```yaml
   allowBuilds:
     esbuild: true
     sharp: true
   ```
2. **Register the integrations** in `astro.config.mjs`:
   ```js
   import react from '@astrojs/react'
   import starlight from '@astrojs/starlight'
   import idocs from '@the-package-labs/idocs-astro'
   import { defineConfig } from 'astro/config'

   export default defineConfig({
     integrations: [
       idocs(),                 // compiles diagrams/ at build time; the build fails on a broken diagram
       react(),
       starlight({
         title: 'My docs',
         // Widens the content column for diagrams and keeps prose at a readable width.
         customCss: ['@the-package-labs/idocs-astro/starlight.css'],
       }),
     ],
   })
   ```
   `idocs({ dir: 'my-diagrams' })` changes the folder (default `diagrams`).
3. **Types.** In `src/env.d.ts` add `/// <reference types="@the-package-labs/idocs-astro/virtual" />`.
4. **A first diagram.**
   ```sh
   pnpm idocs new shop
   pnpm idocs schema        # editor autocomplete for diagram.yaml
   pnpm idocs check
   ```
5. **A page** (`src/content/docs/shop.mdx`):
   ```mdx
   ---
   title: Shop
   tableOfContents: false
   ---
   import Diagram from '@the-package-labs/idocs-astro/Diagram.astro'

   <Diagram name="shop" />
   ```
6. Add `"check": "idocs check"` to `package.json` scripts, and run it in CI.

For an Astro site without Starlight, the same steps apply except for `customCss`; give the diagram a wide container.

## Publish to GitHub Pages

The template ships `.github/workflows/deploy.yml`. For an existing site, add a workflow that installs, runs `pnpm check`, builds with `SITE_URL=https://<owner>.github.io` and `BASE_PATH=/<repo>`, and deploys `dist/` with `actions/deploy-pages`. In `astro.config.mjs` use `site: process.env.SITE_URL, base: process.env.BASE_PATH`.

The repository's **Settings → Pages → Source** must be set to **GitHub Actions** once. Until it is, the deploy step fails with a 404; the template's workflow detects that and skips the step with a notice.

## Install this skill in another project

```sh
npx skills add The-Package-Labs/idocs --skill idocs          # this project
npx skills add The-Package-Labs/idocs --skill idocs -g       # every project
```

Projects created with `create-idocs` already contain it in `.claude/skills/idocs`.
