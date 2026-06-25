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
  // Fix 2: single disposable manages poller lifetime — no accumulation on reconfigure
  context.subscriptions.push({ dispose: () => poller?.dispose() });

  async function startPolling(userId?: number): Promise<void> {
    const client = await createClient(context.secrets);
    if (!client) return;

    poller?.dispose();
    poller = new Poller(client, userId);

    poller.onMRsUpdated(mrs => {
      treeProvider.update(mrs);
      treeView.badge = mrs.length > 0
        ? { value: mrs.length, tooltip: `${mrs.length} assigned MR(s) awaiting review` }
        : undefined;
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusBar.text = `$(check) Assigned ${now}`;
      statusBar.tooltip = `${mrs.length} MR(s) assigned · synced ${now} · Click to refresh`;
      statusBar.show();
    });

    poller.onPollError(() => {
      statusBar.text = `$(warning) Assigned: sync failed`;
      statusBar.tooltip = 'Failed to reach GitLab · Click to retry';
      statusBar.show();
    });

    poller.start();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.configure', async () => {
      const ok = await configure(context.secrets);
      if (!ok) return;

      // Fix 3: validate token immediately after saving
      const client = await createClient(context.secrets);
      if (!client) return;
      try {
        const user = await client.getCurrentUser();
        await context.globalState.update('assigned.userId', user.id); // Fix 9: persist userId
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
        await reviewMR(item, client);
      } catch (err) {
        vscode.window.showErrorMessage(`Review failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  // Fix 6: open the MR in the browser
  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.openMR', async (item: MRItem) => {
      await vscode.env.openExternal(vscode.Uri.parse(item.mr.web_url));
    })
  );

  // Fix 1: restart poller when the poll interval setting changes
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
    const userId = context.globalState.get<number>('assigned.userId'); // Fix 9
    await startPolling(userId);
  }
}

export function deactivate(): void {
  // pollers are cleaned up via context.subscriptions
}
