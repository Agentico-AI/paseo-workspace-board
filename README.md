# Workspace Board for Paseo

Released under the MIT License. See [LICENSE](LICENSE).

Workspace Board shows active workspaces from connected Paseo hosts in columns by native label. Each column is grouped by Paseo status and sorted by recent interaction. You can filter by host or project, save named views, open workspaces, and use card actions. On desktop, drag a card to another label column to change its label on the board's host.

## Install

Install this directory on a Paseo host with plugins enabled:

```text
paseo plugin install <absolute-path-to-this-directory>
```

For a ZIP transfer, extract the archive to a directory on the daemon machine and pass that directory to `paseo plugin install`. The daemon compiles the TypeScript source when it installs the plugin. No runtime npm installation is needed.

For development, run `npm install`, `npm run typecheck`, and `paseo plugin reload workspace-board` after changing source.

## Sharing

The plugin is self-contained under this directory. Its listing image uses fictional workspaces. A public GitHub repository containing this directory, or a public npm package, can be submitted to the Paseo plugin registry. The registry reviews and pins an exact source revision before it appears in Paseo Cafe.
