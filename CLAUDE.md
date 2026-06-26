# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile   # type-check and build to out/
npm run watch     # incremental compile on save
npm test          # run unit tests (Vitest, no VS Code binary needed)
npm run package   # produce .vsix for distribution
```

Press `F5` in VS Code to open an Extension Development Host for manual testing (`.vscode/launch.json` is pre-configured).

## Architecture

This is a VS Code extension (TypeScript, CommonJS output to `out/`) with no backend — all logic runs inside the extension host process.

**Data flow:**
1. `extension.ts` — `activate()` wires everything together and is the only place commands are registered. On startup it checks SecretStorage for a token; if found it starts the poller automatically. Also stores the numeric GitLab user ID in `globalState` (key `assigned.userId`) after successful configure, for compatibility with self-hosted GitLab instances older than 13.0.
2. `gitlab/client.ts` — thin `fetch` wrapper around GitLab API v4. All requests use `Bearer` token auth. The list-MRs call uses ETags to avoid redundant processing on unchanged data. `getAssignedMRs(userId?)` uses the numeric ID when available, falling back to `assignee_id=me`. Read-only calls use the private `get<T>()` helper; mutating calls (`approveMR`, `postMRNote`) use the private `post<T>()` helper. `getMRPipelineStatus(projectId, mrIid)` fetches the latest pipeline for a single MR via `/pipelines?per_page=1`.
3. `gitlab/poller.ts` — fires `onMRsUpdated`, `onPollError`, and `onAuthError` events. Uses self-rescheduling `setTimeout` with exponential backoff on consecutive failures. After building the combined assigned+reviewer list, batch-fetches pipeline statuses via `Promise.allSettled` and attaches them before firing `onMRsUpdated`. Has an in-flight guard and a `disposed` flag to prevent timer re-arming after disposal. Poller lifetime is managed by a single disposable pushed onto `context.subscriptions` in `extension.ts`; `Poller` itself has no reference to `context`.
4. `ui/mrTreeProvider.ts` — `MRTreeProvider` implements `TreeDataProvider` and `Disposable`. `MRItem` extends `TreeItem` and carries the raw `MR` object so command handlers can access it.
5. `review/checkout.ts` — the one-click review flow: fetches MR changes + project via `GitLabClient`, locates the matching local repo via `vscode.git` extension API (matched by `path_with_namespace` in remote URLs), checks out the source branch, opens diffs (count capped by `assigned.maxDiffFiles` setting, default 20) with `git.openChange`, then tries `github.copilot.reviewChanges` → `workbench.action.chat.open` → marketplace prompt in order of preference.

**Secrets:** GitLab PAT is stored exclusively in `vscode.SecretStorage` (key `assigned.gitlabToken`). The GitLab URL is a regular VS Code setting (`assigned.gitlabUrl`). Never write the token to settings.json or log it.

**Adding new GitLab API calls:** add a method to `GitLabClient` in `src/gitlab/client.ts`. Use the private `get<T>()` helper for reads (pass `useEtag = true` only for list endpoints), and the private `post<T>()` helper for writes. Mutating actions (`approveMR`, `postMRNote`) require `api` scope — handle 403 in command handlers with a clear "needs api scope" message, and handle 401 by calling `handleAuthError()` to clear the token and prompt reconfiguration.

**Git API:** The extension accesses git repos through `vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`. The extension is activated explicitly with `await gitExt.activate()` before calling `getAPI` to handle fresh VS Code windows. Repo matching is done by checking remote URLs against `project.path_with_namespace` — not by workspace folder path, because the repo may be anywhere on disk.

## Tests

Unit tests live alongside source in `src/gitlab/client.test.ts` and `src/gitlab/poller.test.ts`. They use Vitest with `vi.mock('vscode', ...)` to avoid needing a VS Code binary. Run with `npm test`. Test files are excluded from the compiled `out/` directory via `tsconfig.json`.

19 tests currently cover: URL construction for assigned/reviewer MR list endpoints, ETag caching, `GitLabError` on non-2xx responses, `getMRDiffs` with `/changes` fallback, `getMRPipelineStatus`, `approveMR` (including 403), `postMRNote` (including 403), poller event firing on success/partial failure/full failure, auth error detection and stop, pipeline status attachment, and the in-flight guard.
