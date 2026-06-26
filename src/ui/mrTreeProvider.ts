import * as vscode from 'vscode';
import { TaggedMR } from '../gitlab/client';

export class MRItem extends vscode.TreeItem {
  constructor(public readonly mr: TaggedMR) {
    super(mr.title, vscode.TreeItemCollapsibleState.None);

    const roleSuffix = mr.role === 'reviewer' ? ' · reviewer' : '';
    const ciSuffix = mr.pipelineStatus === 'success' ? ' ✓'
      : mr.pipelineStatus === 'failed' ? ' ✗'
      : (mr.pipelineStatus === 'running' || mr.pipelineStatus === 'pending') ? ' ↻'
      : '';
    const draftSuffix = mr.work_in_progress ? ' [DRAFT]' : '';
    const conflictSuffix = mr.has_conflicts ? ' ⚠' : '';
    const upvoteSuffix = mr.upvotes > 0 ? ` +${mr.upvotes}` : '';

    this.description = `${mr.references.full}${draftSuffix}${conflictSuffix}${ciSuffix} · ${mr.author.name}${roleSuffix}${upvoteSuffix}`;

    const ciLine = mr.pipelineStatus ? `\n\nCI: ${mr.pipelineStatus}` : '';
    const draftLine = mr.work_in_progress ? '\n\n⚠ Draft MR — not ready to merge' : '';
    const conflictLine = mr.has_conflicts ? '\n\n⚠ Has merge conflicts' : '';
    const upvoteLine = mr.upvotes > 0 ? `\n\n👍 ${mr.upvotes} approval(s)` : '';

    this.tooltip = new vscode.MarkdownString(
      `**${mr.title}**\n\n` +
      `Role: ${mr.role === 'reviewer' ? 'Reviewer' : 'Assignee'}\n\n` +
      `Branch: \`${mr.source_branch}\` → \`${mr.target_branch}\`` +
      ciLine + draftLine + conflictLine + upvoteLine + `\n\n` +
      `[Open on GitLab](${mr.web_url})`
    );
    this.contextValue = 'mr';
    this.iconPath = new vscode.ThemeIcon(mr.role === 'reviewer' ? 'eye' : 'git-pull-request');
  }
}

export class MRTreeProvider implements vscode.TreeDataProvider<MRItem>, vscode.Disposable {
  private mrs: TaggedMR[] = [];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  update(mrs: TaggedMR[]): void {
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
