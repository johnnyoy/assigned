import * as vscode from 'vscode';
import { GitLabClient, MR } from './client';
import { getConfig } from '../config';

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly _onMRsUpdated = new vscode.EventEmitter<MR[]>();
  private readonly _onPollError = new vscode.EventEmitter<Error>();
  readonly onMRsUpdated = this._onMRsUpdated.event;
  readonly onPollError = this._onPollError.event;

  constructor(
    private readonly client: GitLabClient,
    private readonly userId?: number
  ) {}

  start(): void {
    this.fetch();
    const intervalMs = getConfig().pollIntervalMinutes * 60_000;
    this.timer = setInterval(() => this.fetch(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async fetch(): Promise<void> {
    try {
      const mrs = await this.client.getAssignedMRs(this.userId);
      this._onMRsUpdated.fire(mrs);
    } catch (err) {
      this._onPollError.fire(err instanceof Error ? err : new Error(String(err)));
    }
  }

  dispose(): void {
    this.stop();
    this._onMRsUpdated.dispose();
    this._onPollError.dispose();
  }
}
