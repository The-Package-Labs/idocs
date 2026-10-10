# @the-package-labs/idocs

The `idocs` command line.

```sh
idocs check [root...] [--json] [--strict]   validate diagrams; errors say file:line:col and suggest fixes
idocs list [root] [--json]                  diagrams, views and scenarios
idocs schema [root]                         write diagrams/diagram.schema.json for editor autocomplete
idocs icons search <query>                  find an icon name
idocs new <name> [root]                     scaffold diagrams/<name>/
```

`check` also warns when a node's `refs:` point at files that no longer exist.
