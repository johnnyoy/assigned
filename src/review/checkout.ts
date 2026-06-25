import * as vscode from 'vscode';
import { GitLabClient } from '../gitlab/client';
import { MRItem } from '../ui/mrTreeProvider';

interface GitRemote {
  fetchUrl?: string;
  pushUrl?: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: { remotes: GitRemote[] };
  fetch(remote?: string, branch?: string): Promise<void>;
  checkout(branch: string): Promise<void>;
}

export async function reviewMR(item: MRItem, client: GitLabClient): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Assigned: Reviewing "${item.mr.title}"`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Fetching MR details…' });
      const [detail, project] = await Promise.all([
        client.getMRChanges(item.mr.project_id, item.mr.iid),
        client.getProject(item.mr.project_id),
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

      progress.report({ message: `Checking out ${item.mr.source_branch}…` });
      try {
        await repo.fetch('origin', item.mr.source_branch);
      } catch {
        // fetch may fail if branch already exists locally — continue
      }
      await repo.checkout(item.mr.source_branch);

      progress.report({ message: 'Opening diffs…' });
      const maxFiles = vscode.workspace.getConfiguration('assigned').get<number>('maxDiffFiles', 20);
      const changes = detail.changes.filter(c => !c.deleted_file).slice(0, maxFiles);
      if (detail.changes.length > maxFiles) {
        vscode.window.showWarningMessage(
          `MR has ${detail.changes.length} changed files — showing first ${maxFiles}.`
        );
      }

      for (const change of changes) {
        const fileUri = vscode.Uri.joinPath(repo.rootUri, change.new_path);
        try {
          await vscode.commands.executeCommand('git.openChange', fileUri);
        } catch {
          await vscode.window.showTextDocument(fileUri, { preview: true, preserveFocus: true });
        }
      }

      progress.report({ message: 'Launching Copilot review…' });
      await triggerCopilotReview(item.mr.title);
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
  return input.replace(/<\//g, '').replace(/`/g, "'").slice(0, 200);
}
