import * as vscode from 'vscode';
import { configure, getToken } from './config';
import { createClient } from './gitlab/client';
import { Poller } from './gitlab/poller';
import { MRTreeProvider, MRItem } from './ui/mrTreeProvider';
import { reviewMR } from './review/checkout';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const treeProvider = new MRTreeProvider();
  const treeView = vscode.window.createTreeView('assigned.mrList', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  let poller: Poller | null = null;

  async function startPolling(): Promise<void> {
    const client = await createClient(context.secrets);
    if (!client) return;

    poller?.stop();
    poller = new Poller(client, context);
    poller.onMRsUpdated(mrs => {
      treeProvider.update(mrs);
      treeView.badge = mrs.length > 0
        ? { value: mrs.length, tooltip: `${mrs.length} assigned MR(s) awaiting review` }
        : undefined;
    });
    poller.start();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('assigned.configure', async () => {
      const ok = await configure(context.secrets);
      if (ok) {
        await startPolling();
        vscode.window.showInformationMessage('Assigned is watching your GitLab MRs.');
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

  // Auto-start if already configured
  const token = await getToken(context.secrets);
  if (token) {
    await startPolling();
  }
}

export function deactivate(): void {
  // pollers are cleaned up via context.subscriptions
}
