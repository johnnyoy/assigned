# Assigned

A VS Code extension that watches GitLab for merge requests assigned to you and lets you review them in one click — checkout the branch, open the diffs, and launch a Copilot review without leaving your editor.

## Prerequisites

- VS Code 1.85 or later
- A GitLab account (gitlab.com or self-hosted)
- A GitLab Personal Access Token with **`read_api`** scope (or **`api`** scope to also approve MRs and post comments)
- [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) (optional — diffs open without it, but the AI review step requires it)

## Installation

### From source (development)

```bash
git clone https://github.com/johnnyoy/assigned
cd assigned
npm install
```

Then press **F5** in VS Code — the extension builds and opens in an Extension Development Host automatically.

### Package as .vsix

```bash
npm run package
```

This produces `assigned-0.1.0.vsix`. Install it via **Extensions → … → Install from VSIX**.

## Setup

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Assigned: Configure**
3. Enter your GitLab instance URL (e.g. `https://gitlab.com` or `https://gitlab.mycompany.com`)
4. Paste your Personal Access Token

The token is validated immediately against `GET /api/v4/user`. If it's invalid or missing `read_api` scope, you'll be told right away. The token is stored in VS Code's encrypted secret storage and never written to disk or settings files.

**Creating a GitLab PAT:**
GitLab → User Settings → Access Tokens → New token → scope: `read_api`

## Usage

After setup, the **Assigned Reviews** panel appears in the activity bar. A badge shows the count of open assignments, and the status bar shows when the list was last synced.

| Action | How |
|--------|-----|
| See assigned MRs | Open the Assigned panel — refreshes automatically every 10 minutes |
| Force refresh | Click the ↺ button in the panel title bar, or run **Assigned: Refresh Now** |
| Open MR in browser | Click the ↗ button next to any MR |
| Review an MR | Click the ▷ button next to any MR |
| Approve an MR | Click the ✓ button next to any MR (requires `api` scope — see note below) |
| Request changes | Click the 💬 button next to any MR and enter your comment (`api` scope required) |
| Reconfigure token or URL | Run **Assigned: Configure** again |
| Sign out | Click the sign-out button in the panel title bar, or run **Assigned: Sign Out** |

### MR status indicators

Each MR in the sidebar shows compact status badges in its description line:

| Badge | Meaning |
|-------|---------|
| `[DRAFT]` | MR is a draft (work in progress) — not ready to merge |
| `⚠` | MR has merge conflicts |
| `✓` | CI pipeline passed |
| `✗` | CI pipeline failed |
| `↻` | CI pipeline running or pending |
| `+N` | N approvals received |

> **Note on `api` scope:** The default `read_api` token scope covers all read operations (viewing MRs, CI status, diffs). The **Approve** and **Request Changes** actions require a token with full `api` scope. If you get a "requires api scope" error, reconfigure your token: GitLab → User Settings → Access Tokens → scope: `api`.

### What "Review" does

1. Fetches the MR's changed files from GitLab
2. Finds the repository in your currently open VS Code workspace (matched by remote URL)
3. Fetches and checks out the MR's source branch
4. Opens diffs for up to `assigned.maxDiffFiles` changed files (default: 20)
5. Triggers **GitHub Copilot's** `reviewChanges` command (falls back to opening Copilot Chat with `/review`)

If the repository isn't open in VS Code yet, the extension offers to clone it for you.

## Configuration

Set these in VS Code settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `assigned.gitlabUrl` | `https://gitlab.com` | Your GitLab instance URL |
| `assigned.pollIntervalMinutes` | `10` | How often to check for new MRs (minutes). Changes take effect immediately. |
| `assigned.maxDiffFiles` | `20` | Maximum number of changed files to open as diffs during a review (max 100) |

## Development

```bash
npm run compile   # build once
npm run watch     # rebuild on save
npm test          # run unit tests (Vitest, no VS Code needed)
npm run package   # produce assigned-x.x.x.vsix
```

Press **F5** to launch the Extension Development Host (`.vscode/launch.json` is pre-configured). After editing source, recompile and run `Developer: Restart Extension Host` from the Command Palette.

**Project structure:**

```
src/
├── extension.ts          # activate() — wires everything together
├── config.ts             # token + settings read/write
├── gitlab/
│   ├── client.ts         # GitLab API v4 (fetch + ETag caching)
│   ├── client.test.ts    # unit tests: URL construction, error handling, ETag
│   ├── poller.ts         # setInterval-based polling, onMRsUpdated / onPollError events
│   └── poller.test.ts    # unit tests: event firing on success and failure
├── ui/
│   └── mrTreeProvider.ts # sidebar TreeView
└── review/
    └── checkout.ts       # one-click review flow
```

## Limitations (v0.1)

- GitLab only (GitHub support planned)
- The repository must be cloned locally and open in VS Code for the one-click review to work
- Up to 50 MRs shown per poll
- Polling only — no webhooks, so new assignments appear within one poll interval

## Roadmap

- Post review findings as GitLab MR comments
- GitHub support
- Multiple GitLab instances
- Configurable review prompt / custom AI instructions
