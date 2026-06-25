import * as path from 'path';
import * as vscode from 'vscode';
import { GitLabClient, MR } from '../gitlab/client';

interface GitRemote {
  fetchUrl?: string;
  pushUrl?: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    remotes: GitRemote[];
    workingTreeChanges: unknown[];
    indexChanges: unknown[];
  };
  fetch(remote?: string, branch?: string): Promise<void>;
  checkout(branch: string): Promise<void>;
}

export async function reviewMR(mr: MR, client: GitLabClient): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Assigned: Reviewing "${mr.title}"`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Fetching MR details…' });
      const [diffs, project] = await Promise.all([
        client.getMRDiffs(mr.project_id, mr.iid),
        client.getProject(mr.project_id),
      ]);

      progress.report({ message: 'Looking for local repository…' });
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt) {
        vscode.window.showErrorMessage('Git extension not found. Please enable the built-in Git extension.');
        return;
      }
      if (!gitExt.isActive) {
        await gitExt.activate();
      }

      const git = gitExt.exports.getAPI(1);
      const repo: GitRepository | undefined = git.repositories.find((r: GitRepository) =>
        r.state.remotes.some((remote: GitRemote) =>
          remote.fetchUrl?.includes(project.path_with_namespace) ||
          remote.pushUrl?.includes(project.path_with_namespace)
        )
      );

      if (!repo) {
        const choice = await vscode.window.showWarningMessage(
          `Repository "${project.path_with_namespace}" is not open in VS Code.`,
          'Clone It',
          'Cancel'
        );
        if (choice === 'Clone It') {
          await vscode.commands.executeCommand('git.clone', project.http_url_to_repo);
        }
        return;
      }

      // Dirty-tree check before checkout
      const isDirty = repo.state.workingTreeChanges.length > 0 || repo.state.indexChanges.length > 0;
      if (isDirty) {
        vscode.window.showErrorMessage(
          'Commit or stash your changes before reviewing this MR.'
        );
        return;
      }

      progress.report({ message: `Checking out ${mr.source_branch}…` });
      try {
        await repo.fetch('origin', mr.source_branch);
      } catch {
        // fetch may fail if branch already exists locally — continue
      }
      await repo.checkout(mr.source_branch);

      progress.report({ message: 'Opening diffs…' });
      const maxFiles = vscode.workspace.getConfiguration('assigned').get<number>('maxDiffFiles', 20);
      const nonDeleted = diffs.filter(c => !c.deleted_file);
      if (nonDeleted.length > maxFiles) {
        vscode.window.showWarningMessage(
          `MR has ${nonDeleted.length} changed files — showing first ${maxFiles}.`
        );
      }
      const toOpen = nonDeleted.slice(0, maxFiles);
      const repoFsPath = repo.rootUri.fsPath;

      for (const change of toOpen) {
        const fileUri = vscode.Uri.joinPath(repo.rootUri, change.new_path);
        // Path traversal guard
        if (!fileUri.fsPath.startsWith(repoFsPath + path.sep) && fileUri.fsPath !== repoFsPath) {
          continue;
        }
        try {
          await vscode.commands.executeCommand('git.openChange', fileUri);
        } catch {
          await vscode.window.showTextDocument(fileUri, { preview: true, preserveFocus: true });
        }
      }

      progress.report({ message: 'Launching Copilot review…' });
      await triggerCopilotReview(mr.title);
    }
  );
}

async function triggerCopilotReview(mrTitle: string): Promise<void> {
  const hasCopilotChat = !!vscode.extensions.getExtension('GitHub.copilot-chat');
  if (hasCopilotChat) {
    try {
      await vscode.commands.executeCommand('github.copilot.reviewChanges');
      return;
    } catch {
      // command may not exist in all Copilot versions — fall through
    }
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `/review ${sanitize(mrTitle)}`,
      });
      return;
    } catch {
      // chat unavailable
    }
  }

  const choice = await vscode.window.showInformationMessage(
    'Diffs are open. Install GitHub Copilot Chat for one-click AI review.',
    'Get Copilot Chat'
  );
  if (choice === 'Get Copilot Chat') {
    await vscode.env.openExternal(
      vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat')
    );
  }
}

function sanitize(input: string): string {
  return input.replace(/\s+/g, ' ').replace(/<\//g, '').replace(/`/g, "'").slice(0, 200);
}
