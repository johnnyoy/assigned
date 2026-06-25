import * as vscode from 'vscode';
import { configure, getToken, clearToken } from './config';
import { createClient } from './gitlab/client';
import { Poller } from './gitlab/poller';
import { MRTreeProvider, MRItem } from './ui/mrTreeProvider';
import { reviewMR } from './review/checkout';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const treeProvider = new MRTreeProvider();
  context.subscriptions.push(treeProvider);
  const treeView = vscode.window.createTreeView('assigned.mrList', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'assigned.refresh';
  context.subscriptions.push(statusBar);

  let poller: Poller | null = null;
  context.subscriptions.push({ dispose: () => poller?.dispose() });

  async function setConfigured(value: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'assigned.configured', value);
  }

  async function handleAuthError(): Promise<void> {
    poller?.dispose();
    poller = null;
    await clearToken(context.secrets);
    await context.globalState.update('assigned.userId', undefined);
    await setConfigured(false);
    treeProvider.update([]);
    treeView.badge = undefined;
    statusBar.text = '$(warning) Assigned: auth failed';
    statusBar.tooltip = 'GitLab token expired or revoked · Click to reconfigure';
    statusBar.show();
    const choice = await vscode.window.showErrorMessage(
      'Assigned: GitLab token expired or revoked. Please reconfigure.',
      'Configure'
    );
    if (choice === 'Configure') {
      await vscode.commands.executeCommand('assigned.configure');
    }
  }

  async function startPolling(userId?: number): Promise<void> {
    const client = await createClient(context.secrets);
    if (!client) return;

    poller?.dispose();
    poller = new Poller(client, userId);

    poller.onMRsUpdated(mrs => {
      treeProvider.update(mrs);
      treeView.badge = mrs.length > 0
        ? { value: mrs.length, tooltip: `${mrs.length} MR(s) awaiting review` }
        : undefined;
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusBar.text = `$(check) Assigned ${now}`;
      statusBar.tooltip = `${mrs.length} MR(s) · synced ${now} · Click to refresh`;
      statusBar.show();
    });

    poller.onPollError(() => {
      statusBar.text = `$(warning) Assigned: sync failed`;
      statusBar.tooltip = 'Failed to reach GitLab · Click to retry';
      statusBar.show();
    });

    poller.onAuthError(() => {
      void handleAuthError();
    });

    poller.start();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.configure', async () => {
      const ok = await configure(context.secrets);
      if (!ok) return;

      const client = await createClient(context.secrets);
      if (!client) return;
      try {
        const user = await client.getCurrentUser();
        await context.globalState.update('assigned.userId', user.id);
        await setConfigured(true);
        await startPolling(user.id);
        vscode.window.showInformationMessage(
          `Assigned is watching your GitLab MRs (signed in as @${user.username}).`
        );
      } catch {
        await clearToken(context.secrets);
        vscode.window.showErrorMessage(
          'GitLab token is invalid or missing read_api scope. Please run "Assigned: Configure" again.'
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.signOut', async () => {
      poller?.dispose();
      poller = null;
      await clearToken(context.secrets);
      await context.globalState.update('assigned.userId', undefined);
      await setConfigured(false);
      treeProvider.update([]);
      treeView.badge = undefined;
      statusBar.hide();
      vscode.window.showInformationMessage('Assigned: signed out.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.refresh', async () => {
      if (!poller) {
        vscode.window.showWarningMessage('Assigned is not configured. Run "Assigned: Configure" first.');
        return;
      }
      await poller.fetch();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.reviewMR', async (item: MRItem) => {
      const client = await createClient(context.secrets);
      if (!client) {
        vscode.window.showErrorMessage('Assigned is not configured. Run "Assigned: Configure" first.');
        return;
      }
      try {
        await reviewMR(item.mr, client);
      } catch (err) {
        vscode.window.showErrorMessage(`Review failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.openMR', async (item: MRItem) => {
      const url = item.mr.web_url;
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        vscode.window.showErrorMessage(`Assigned: unsafe URL scheme blocked for "${url}".`);
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('assigned.pollIntervalMinutes')) {
        const userId = context.globalState.get<number>('assigned.userId');
        void startPolling(userId);
      }
    })
  );

  // Auto-start if already configured
  const token = await getToken(context.secrets);
  if (token) {
    const userId = context.globalState.get<number>('assigned.userId');
    await setConfigured(true);
    await startPolling(userId);
  } else {
    await setConfigured(false);
  }
}

export function deactivate(): void {
  // pollers are cleaned up via context.subscriptions
}
