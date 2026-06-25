import { describe, it, expect, vi } from 'vitest';
import { Poller } from './poller';
import { GitLabError } from './client';
import type { GitLabClient, MR, TaggedMR } from './client';

vi.mock('vscode', () => ({
  EventEmitter: class {
    private listeners: Array<(v: unknown) => void> = [];
    event = (fn: (v: unknown) => void) => {
      this.listeners.push(fn);
      return { dispose: () => {} };
    };
    fire(v: unknown) { this.listeners.forEach(l => l(v)); }
    dispose() { this.listeners = []; }
  },
}));

vi.mock('../config', () => ({
  getConfig: () => ({ gitlabUrl: 'https://gitlab.com', pollIntervalMinutes: 10 }),
}));

const fakeMR: MR = {
  id: 1, iid: 1,
  title: 'Test MR',
  author: { name: 'Alice', username: 'alice' },
  source_branch: 'feature', target_branch: 'main',
  web_url: 'https://gitlab.com/org/repo/-/merge_requests/1',
  project_id: 10,
  references: { full: 'org/repo!1' },
};

function makeClient(
  assigned: MR[] | (() => Promise<MR[]>),
  reviewing: MR[] = []
): GitLabClient {
  const assignedImpl = typeof assigned === 'function'
    ? assigned
    : () => Promise.resolve(assigned);
  return {
    getAssignedMRs: vi.fn(assignedImpl),
    getReviewRequestedMRs: vi.fn(() => Promise.resolve(reviewing)),
  } as unknown as GitLabClient;
}

describe('Poller', () => {
  it('fires onMRsUpdated with tagged MRs on full success', async () => {
    const poller = new Poller(makeClient([fakeMR]), 42);

    const mrs = await new Promise<TaggedMR[]>(resolve => {
      poller.onMRsUpdated(v => resolve(v as TaggedMR[]));
      void poller.fetch();
    });

    expect(mrs).toEqual([{ ...fakeMR, role: 'assigned' }]);
    poller.dispose();
  });

  it('fires onMRsUpdated with partial results and onPollError when one section fails', async () => {
    const reviewerMR = { ...fakeMR, id: 2 };
    const client = {
      getAssignedMRs: vi.fn().mockRejectedValue(new Error('network error')),
      getReviewRequestedMRs: vi.fn().mockResolvedValue([reviewerMR]),
    } as unknown as GitLabClient;
    const poller = new Poller(client, 42);

    let capturedError: Error | undefined;
    poller.onPollError(e => { capturedError = e as Error; });

    const mrs = await new Promise<TaggedMR[]>(resolve => {
      poller.onMRsUpdated(v => resolve(v as TaggedMR[]));
      void poller.fetch();
    });

    expect(mrs).toEqual([{ ...reviewerMR, role: 'reviewer' }]);
    expect(capturedError?.message).toContain('network error');
    poller.dispose();
  });

  it('fires only onPollError when both sections fail', async () => {
    const client = {
      getAssignedMRs: vi.fn().mockRejectedValue(new Error('network error')),
      getReviewRequestedMRs: vi.fn().mockRejectedValue(new Error('network error 2')),
    } as unknown as GitLabClient;
    const poller = new Poller(client, 42);

    const err = await new Promise<Error>(resolve => {
      poller.onPollError(e => resolve(e as Error));
      void poller.fetch();
    });

    expect(err.message).toBe('network error');
    poller.dispose();
  });

  it('fires onAuthError and stops scheduling on 401', async () => {
    const client = {
      getAssignedMRs: vi.fn().mockRejectedValue(new GitLabError('Unauthorized', 401)),
      getReviewRequestedMRs: vi.fn().mockResolvedValue([]),
    } as unknown as GitLabClient;
    const poller = new Poller(client, 42);

    const err = await new Promise<GitLabError>(resolve => {
      poller.onAuthError(e => resolve(e as GitLabError));
      void poller.fetch();
    });

    expect(err.status).toBe(401);
    poller.dispose();
  });

  it('in-flight guard: concurrent fetch() calls are no-ops', async () => {
    let resolveFirst!: (v: MR[]) => void;
    const firstPending = new Promise<MR[]>(r => { resolveFirst = r; });
    const mockGetAssigned = vi.fn().mockReturnValue(firstPending);
    const client = {
      getAssignedMRs: mockGetAssigned,
      getReviewRequestedMRs: vi.fn().mockResolvedValue([]),
    } as unknown as GitLabClient;
    const poller = new Poller(client, 42);

    const first = poller.fetch();
    const second = poller.fetch(); // should be a no-op

    resolveFirst([fakeMR]);
    await first;
    await second;

    expect(mockGetAssigned).toHaveBeenCalledTimes(1);
    poller.dispose();
  });
});
