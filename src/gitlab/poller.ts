import * as vscode from 'vscode';
import { GitLabClient, GitLabError, TaggedMR } from './client';
import { getConfig } from '../config';

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  private readonly _onMRsUpdated = new vscode.EventEmitter<TaggedMR[]>();
  private readonly _onPollError = new vscode.EventEmitter<Error>();
  private readonly _onAuthError = new vscode.EventEmitter<GitLabError>();
  readonly onMRsUpdated = this._onMRsUpdated.event;
  readonly onPollError = this._onPollError.event;
  readonly onAuthError = this._onAuthError.event;

  constructor(
    private readonly client: GitLabClient,
    private readonly userId?: number
  ) {}

  start(): void {
    this.fetch();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.stop();
    this.timer = setTimeout(() => this.fetch(), delayMs);
  }

  async fetch(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const [assignedResult, reviewingResult] = await Promise.allSettled([
        this.client.getAssignedMRs(this.userId),
        this.client.getReviewRequestedMRs(this.userId),
      ]);

      // Check for auth errors in either result
      for (const result of [assignedResult, reviewingResult]) {
        if (result.status === 'rejected') {
          const err = result.reason;
          if (err instanceof GitLabError && (err.status === 401 || err.status === 403)) {
            this.stop();
            this._onAuthError.fire(err);
            return;
          }
        }
      }

      // Build combined list from whichever sections succeeded
      const assigned = assignedResult.status === 'fulfilled' ? assignedResult.value : [];
      const reviewing = reviewingResult.status === 'fulfilled' ? reviewingResult.value : [];

      const bothFailed = assignedResult.status === 'rejected' && reviewingResult.status === 'rejected';
      if (bothFailed) {
        const err = (assignedResult as PromiseRejectedResult).reason;
        this._onPollError.fire(err instanceof Error ? err : new Error(String(err)));
        this.consecutiveFailures++;
      } else {
        // At least one succeeded — surface partial failure as a non-fatal warning
        if (assignedResult.status === 'rejected' || reviewingResult.status === 'rejected') {
          const failedSection = assignedResult.status === 'rejected' ? 'assigned' : 'reviewer';
          const err = (assignedResult.status === 'rejected' ? assignedResult : reviewingResult as PromiseRejectedResult).reason;
          this._onPollError.fire(new Error(`Partial failure (${failedSection}): ${err instanceof Error ? err.message : String(err)}`));
        }
        const seen = new Set<number>();
        const all: TaggedMR[] = [];
        for (const mr of assigned) { seen.add(mr.id); all.push({ ...mr, role: 'assigned' }); }
        for (const mr of reviewing) { if (!seen.has(mr.id)) all.push({ ...mr, role: 'reviewer' }); }

        if (all.length > 0) {
          const pipelineResults = await Promise.allSettled(
            all.map(mr => this.client.getMRPipelineStatus(mr.project_id, mr.iid))
          );
          for (let i = 0; i < all.length; i++) {
            const result = pipelineResults[i];
            if (result.status === 'fulfilled' && result.value !== null) {
              all[i] = { ...all[i], pipelineStatus: result.value };
            }
          }
        }

        this._onMRsUpdated.fire(all);
        this.consecutiveFailures = 0;
      }
    } finally {
      this.inFlight = false;
    }

    // Self-reschedule with backoff on failures
    const baseMs = getConfig().pollIntervalMinutes * 60_000;
    const delay = this.consecutiveFailures === 0
      ? baseMs
      : Math.min(baseMs * Math.pow(2, this.consecutiveFailures), baseMs * 6);
    this.scheduleNext(delay);
  }

  dispose(): void {
    this.stop();
    this._onMRsUpdated.dispose();
    this._onPollError.dispose();
    this._onAuthError.dispose();
  }
}
