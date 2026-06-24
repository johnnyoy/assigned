import * as vscode from 'vscode';
import { GitLabClient, MR } from './client';
import { getConfig } from '../config';

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly _onMRsUpdated = new vscode.EventEmitter<MR[]>();
  readonly onMRsUpdated = this._onMRsUpdated.event;

  constructor(
    private readonly client: GitLabClient,
    private readonly context: vscode.ExtensionContext
  ) {}

  start(): void {
    this.fetch();
    const intervalMs = getConfig().pollIntervalMinutes * 60_000;
    this.timer = setInterval(() => this.fetch(), intervalMs);
    this.context.subscriptions.push({ dispose: () => this.stop() });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async fetch(): Promise<void> {
    try {
      const mrs = await this.client.getAssignedMRs();
      this._onMRsUpdated.fire(mrs);
    } catch {
      // silently swallow poll errors (network blips, token expiry handled via UI)
    }
  }

  dispose(): void {
    this.stop();
    this._onMRsUpdated.dispose();
  }
}
