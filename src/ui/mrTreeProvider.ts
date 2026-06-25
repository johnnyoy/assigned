import * as vscode from 'vscode';
import { MR } from '../gitlab/client';

export class MRItem extends vscode.TreeItem {
  constructor(public readonly mr: MR) {
    super(mr.title, vscode.TreeItemCollapsibleState.None);
    this.description = `${mr.references.full} · ${mr.author.name}`;
    this.tooltip = new vscode.MarkdownString(
      `**${mr.title}**\n\n` +
      `Branch: \`${mr.source_branch}\` → \`${mr.target_branch}\`\n\n` +
      `[Open on GitLab](${mr.web_url})`
    );
    this.contextValue = 'mr';
    this.iconPath = new vscode.ThemeIcon('git-pull-request');
  }
}

export class MRTreeProvider implements vscode.TreeDataProvider<MRItem>, vscode.Disposable {
  private mrs: MR[] = [];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  update(mrs: MR[]): void {
    this.mrs = mrs;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MRItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MRItem[] {
    return this.mrs.map(mr => new MRItem(mr));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
