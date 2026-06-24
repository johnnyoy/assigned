# Assigned

A VS Code extension that watches GitLab for merge requests assigned to you and lets you review them in one click — checkout the branch, open the diffs, and launch a Copilot review without leaving your editor.

## Prerequisites

- VS Code 1.85 or later
- A GitLab account (gitlab.com or self-hosted)
- A GitLab Personal Access Token with **`read_api`** scope
- [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) (optional — diffs open without it, but the AI review step requires it)

## Installation

### From source (development)

```bash
git clone https://github.com/johnnyoy/assigned
cd assigned
npm install
npm run compile
```

Then press **F5** in VS Code to open an Extension Development Host with the extension loaded.

### Package as .vsix

```bash
npm install -g @vscode/vsce
vsce package
```

This produces `assigned-0.1.0.vsix`. Install it via **Extensions → … → Install from VSIX**.

## Setup

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Assigned: Configure**
3. Enter your GitLab instance URL (e.g. `https://gitlab.com` or `https://gitlab.mycompany.com`)
4. Paste your Personal Access Token

Your token is stored in VS Code's encrypted secret storage and never written to disk or settings files.

**Creating a GitLab PAT:**
GitLab → User Settings → Access Tokens → New token → scope: `read_api`

## Usage

After setup, the **Assigned Reviews** panel appears in the activity bar (look for the review icon).

| Action | How |
|--------|-----|
| See assigned MRs | Open the Assigned panel — it refreshes automatically every 10 minutes |
| Force refresh | Click the ↺ button in the panel title bar, or run **Assigned: Refresh Now** |
| Review an MR | Click the ▷ button next to any MR in the list |
| Reconfigure token or URL | Run **Assigned: Configure** again |

### What "Review" does

1. Fetches the MR's changed files from GitLab
2. Finds the repository in your currently open VS Code workspace
3. Fetches and checks out the MR's source branch
4. Opens diffs for up to 20 changed files
5. Triggers **GitHub Copilot's** `reviewChanges` command (falls back to opening Copilot Chat with `/review`)

If the repository isn't open in VS Code yet, the extension offers to clone it for you.

## Configuration

Set these in VS Code settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `assigned.gitlabUrl` | `https://gitlab.com` | Your GitLab instance URL |
| `assigned.pollIntervalMinutes` | `10` | How often to check for new MRs (minutes) |

## Development

```bash
npm run compile   # build once
npm run watch     # rebuild on save
```

Press **F5** to launch the Extension Development Host. Changes to source files require a recompile (`npm run compile`) and an **Extension Host restart** (`Ctrl+Shift+P → Developer: Restart Extension Host`).

**Project structure:**

```
src/
├── extension.ts          # activate() — wires everything together
├── config.ts             # token + settings read/write
├── gitlab/
│   ├── client.ts         # GitLab API v4 (fetch + ETag caching)
│   └── poller.ts         # setInterval-based polling
├── ui/
│   └── mrTreeProvider.ts # sidebar TreeView
└── review/
    └── checkout.ts       # one-click review flow
```

## Limitations (v0.1)

- GitLab only (GitHub support planned)
- The repository must be cloned locally and open in VS Code for the one-click review to work
- Up to 50 MRs shown; up to 20 diffs opened per review
- Polling only — no webhooks, so new assignments appear within one poll interval

## Roadmap

- Post review findings as GitLab MR comments
- GitHub support
- Multiple GitLab instances
- Configurable review prompt / custom AI instructions
- Status bar indicator showing last poll time
