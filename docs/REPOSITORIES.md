# Repositories, packages and releases

## How many repositories?

**One that you work in, and optionally a second that is generated.**

| Repository | Needed? | What it is |
|---|---|---|
| **This one** (the monorepo) | yes | Everything you edit: the packages, the docs and landing site, the template's source, the scaffolder. |
| **A template repository** | only for the GitHub "Use this template" button | A copy of `templates/starter`, written by CI after each release. Nobody edits it by hand. |
| A separate repository for the landing page and docs | **no** | They live in `apps/docs`, next to the code they describe. |

`npm create idocs@latest my-docs` works without the template repository: the scaffolder carries its own copy of the template. Create the template repository only if you also want people to click **Use this template** on GitHub.

### Why the docs and landing page stay here

- A change to the format, the renderer or the CLI and the page that documents it go in **one pull request**, and CI builds both. A separate docs repository drifts.
- The docs site doubles as the live demo and as an end-to-end test (`pnpm test:e2e` drives it in Chrome).
- One issue tracker, one place to look.

Split it out only if different people own the docs, or they need a different release rhythm, or you want a docs site for several products. None of that is true yet.

### Why the template is generated, not hand-maintained

A GitHub template has to be a repository root, and it must depend on **published** `@the-package-labs/idocs-*` versions, not on workspace links, so users get upgrades by bumping a dependency rather than owning a copy of the engine. The monorepo cannot be that template. So `templates/starter` is the source of truth, `scripts/template.mjs` turns it into a standalone project (versions pinned to the current release, placeholders filled, the shared `author-diagram` skill added), and the sync workflow pushes the result to the template repository.

## What is where

```
packages/
  core/            @the-package-labs/idocs-core        schema, compiler, layout, router, timeline
  react/           @the-package-labs/idocs-react       <DiagramView> and styles
  astro/           @the-package-labs/idocs-astro       Astro integration and <Diagram>
  cli/             idocs                         the `idocs` command
  create-idocs/    create-idocs       `npm create idocs`; carries a copy of the template
extensions/
  vscode/          idocs-vscode      the VS Code extension (private; published to the marketplaces, not npm)
apps/
  docs/            idocs-docs        the tool's landing page, guides and live examples (private)
templates/
  starter/         my-docs            the project users start from (private; source of truth)
skills/
  idocs/          the agent skill (SKILL.md + references/ + a tested example); installable with `npx skills add`
scripts/
  build.mjs        builds one package into dist/ (esbuild + tsc declarations)
  template.mjs     templates/starter -> a standalone project
  verify-pack.mjs  packs, scaffolds, installs, builds and loads, like a user would
.changeset/        release notes and versioning
```

In the monorepo, every package's `exports` point at its TypeScript sources, so nothing has to be built to develop. `publishConfig.exports` points at `dist/`, and pnpm applies it when packing. The five packages are versioned together.

## The agent skill

`skills/idocs` is the one copy of the skill. It reaches people three ways, none of which needs a registry:

- **`npx skills add The-Package-Labs/idocs --skill idocs`** installs it into any project, from this repository on GitHub. The installer scans `skills/` (and `.claude/skills/`), so nothing has to be published. skills.sh lists skills by how often they are installed; there is no submission step. The repository has to be **public** for other people to install from it.
- **New projects** get it automatically: `scripts/template.mjs` copies the folder into the template, and `create-idocs` ships that.
- **This repository's own agents** use it through `.claude/skills/idocs`, a symlink to `skills/idocs`.

`packages/cli/test/skill.test.ts` keeps it honest: the example diagram must compile, every link must resolve, and the node, edge and step kinds, the schema fields and the CLI commands it describes must match the code. Change the format and that test tells you which part of the skill to update.

## The VS Code extension

`extensions/vscode` is a workspace of its own and not one of the five packages: it is released to the Visual Studio Marketplace and Open VSX, not npm, and has its own version and `CHANGELOG.md`. Changesets ignore it. It bundles `@the-package-labs/idocs-core` and `@the-package-labs/idocs-react` from the workspace, so a format change reaches users when the extension is next released. How it is built, tested and released is in [extensions/vscode/DEVELOPMENT.md](../extensions/vscode/DEVELOPMENT.md).

## Everyday tasks

| I want to | Do |
|---|---|
| Change the format, layout or renderer | Edit `packages/*`, update `apps/docs` and the skill in the same change. `pnpm test`, `pnpm test:e2e`. |
| Change what new projects start with | Edit `templates/starter`. `pnpm dev:template` to see it; `pnpm verify:pack` proves a fresh project installs and builds from packed packages. |
| Change the docs or landing page | Edit `apps/docs`. `pnpm dev`. |
| Change the agent skill | Edit `skills/idocs`, then `pnpm test`. To try an install: `npx skills add . --skill idocs --copy` from an empty folder. |
| Check everything CI checks | `pnpm lint && pnpm typecheck && pnpm test && pnpm check --strict && pnpm build:all` |
| Try the published experience without publishing | `pnpm verify:pack` (add `--keep` to keep the generated project). |
| Change the editor experience | Edit `extensions/vscode`, then `pnpm test`, `pnpm test:e2e` and `pnpm vscode:test`. Add `--vsix` to test the packed file. |
| Add a package | Create `packages/<name>`, add it to `CONFIG` in `scripts/build.mjs` and to the `fixed` list in `.changeset/config.json`. |

## Releasing

**Published:** `0.1.0` of all five packages went out on 2026-10-07 under the `packagelab` org, and `0.2.0` on 2026-10-10 (from a laptop, with a granular npm token that bypasses two-factor authentication; an ordinary token is refused with a 403). Both were published under the project's first name, docspp, in the `packagelab` org: `@packagelab/docspp-core`, `-react`, `-astro`, `docspp` and `create-docspp`. The next release is the first under the idocs names; once it is out, deprecate the old ones with `npm deprecate <old-name> "Renamed to <new-name>"` so their users find the new packages. New scoped packages show a stray `0.0.0-stage` placeholder version on npm; it is created by npm, not by us, and `latest` points at the real release.

Releases use [changesets](https://github.com/changesets/changesets).

1. For a change users should hear about: `pnpm changeset`, pick the packages and the bump, commit the file.
2. On `main`, the **Release** workflow collects pending changesets into a "Version packages" pull request. Merging it publishes every package to npm and tags the release.
3. The **Sync template repository** workflow then pushes the new template to the template repository (if configured).

Both workflows are **off** until you opt in, so pushing to `main` can never publish by accident.

### Before the first release

These are your decisions; nothing here has been done for you.

- [x] **A license.** MIT, in `LICENSE`; each build copies it into the package folders, and `verify:pack` checks it is in every tarball.
- [x] **The npm names.** The org is `the-package-labs`. Libraries are `@the-package-labs/idocs-core`, `-react` and `-astro`; the CLI is `@the-package-labs/idocs`, whose command is `idocs` (npm refused the unscoped `idocs` as too similar to `docx` and `docz`); the scaffolder is the unscoped `create-idocs` (so `npm create idocs` works). They replaced the docspp names (and the `packagelab` org) after `0.2.0`; renaming again is expensive, so treat these as fixed. They appear in each `package.json`, `scripts/build.mjs`, `templates/starter/package.json`, `.changeset/config.json`, the skill and the docs.
- [x] **URLs.** `homepage` and `repository` in the root and package `package.json` files point at `github.com/The-Package-Labs/idocs` (the project moved there from `AhmeddBasemm/docspp`). Update them if the repository moves again.
- [ ] **npm token.** For automated releases, create an automation token that can publish to the `the-package-labs` org and the unscoped `create-idocs`, and add it as the `NPM_TOKEN` repository secret. The first publish can be done from a laptop with `npm login` and `pnpm release`.
- [ ] **Turn it on.** Set the repository variable `RELEASE_ENABLED` to `true`.
- [x] **Make the repository public** if people should be able to run `npx skills add <you>/idocs` against it.
- [x] **Docs site.** Pages is on the **GitHub Actions** source and `apps/docs` deploys on every push to `main`. In a repository without Pages enabled the workflow still builds the site and skips the deploy step with a notice, so CI stays green.

### The template repository (optional)

1. Create an empty repository, for example `your-name/idocs-starter`, and tick **Template repository** in its settings.
2. In this repository set the variable `TEMPLATE_REPO` to `your-name/idocs-starter` and the secret `TEMPLATE_REPO_TOKEN` to a token with write access to it.
3. Run **Sync template repository** once by hand (Actions tab) after the first release.

You can preview what it will contain at any time: `node scripts/template.mjs --out /tmp/idocs-starter`.
