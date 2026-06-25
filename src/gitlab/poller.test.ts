import { describe, it, expect, vi } from 'vitest';
import { Poller } from './poller';
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

describe('Poller', () => {
  it('fires onMRsUpdated on success and onPollError on failure', async () => {
    const mockClient = {
      getAssignedMRs: vi.fn()
        .mockResolvedValueOnce([fakeMR])
        .mockRejectedValueOnce(new Error('network error')),
      getReviewRequestedMRs: vi.fn().mockResolvedValue([]),
    } as unknown as GitLabClient;

    const poller = new Poller(mockClient, 42);

    // First fetch: success — fakeMR is an assignee MR, so it gets role: 'assigned'
    const updatedMRs = await new Promise<TaggedMR[]>(resolve => {
      poller.onMRsUpdated(mrs => resolve(mrs as TaggedMR[]));
      poller.fetch();
    });
    expect(updatedMRs).toEqual([{ ...fakeMR, role: 'assigned' }]);

    // Second fetch: failure (getAssignedMRs rejects)
    const pollError = await new Promise<Error>(resolve => {
      poller.onPollError(err => resolve(err as Error));
      poller.fetch();
    });
    expect(pollError.message).toBe('network error');

    poller.dispose();
  });
});
