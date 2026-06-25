import * as vscode from 'vscode';
import { GitLabClient, TaggedMR } from './client';
import { getConfig } from '../config';

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly _onMRsUpdated = new vscode.EventEmitter<TaggedMR[]>();
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
      const [assigned, reviewing] = await Promise.all([
        this.client.getAssignedMRs(this.userId),
        this.client.getReviewRequestedMRs(this.userId),
      ]);
      const seen = new Set<number>();
      const all: TaggedMR[] = [];
      for (const mr of assigned) { seen.add(mr.id); all.push({ ...mr, role: 'assigned' }); }
      for (const mr of reviewing) { if (!seen.has(mr.id)) all.push({ ...mr, role: 'reviewer' }); }
      this._onMRsUpdated.fire(all);
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
