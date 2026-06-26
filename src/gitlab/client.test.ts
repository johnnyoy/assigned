import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabClient, GitLabError } from './client';

vi.mock('vscode', () => ({}));
vi.mock('../config', () => ({
  getConfig: () => ({ gitlabUrl: 'https://gitlab.com', pollIntervalMinutes: 10 }),
  getToken: vi.fn(),
}));

function makeFetch(status: number, body: unknown, etag?: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h === 'etag' && etag ? etag : null) },
    json: async () => body,
    text: async () => String(body),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', undefined);
});

describe('GitLabClient.getAssignedMRs', () => {
  it('uses numeric userId in URL when provided', async () => {
    const mockFetch = makeFetch(200, []);
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    await client.getAssignedMRs(42);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('assignee_id=42');
    expect(calledUrl).not.toContain('assignee_id=me');
  });

  it('falls back to assignee_id=me when userId is not provided', async () => {
    const mockFetch = makeFetch(200, []);
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    await client.getAssignedMRs();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('assignee_id=me');
  });
});

describe('GitLabClient.getReviewRequestedMRs', () => {
  it('URL contains scope=all and reviewer_id', async () => {
    const mockFetch = makeFetch(200, []);
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    await client.getReviewRequestedMRs(42);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('reviewer_id=42');
    expect(calledUrl).toContain('scope=all');
  });
});

describe('GitLabClient error handling', () => {
  it('throws GitLabError with status on non-2xx response', async () => {
    vi.stubGlobal('fetch', makeFetch(401, 'Unauthorized'));

    const client = new GitLabClient('https://gitlab.com', 'bad-token');
    const err = await client.getCurrentUser().catch(e => e);

    expect(err).toBeInstanceOf(GitLabError);
    expect(err.message).toContain('GitLab API 401');
    expect(err.status).toBe(401);
  });
});

describe('GitLabClient ETag caching', () => {
  it('sends If-None-Match on second request and returns cached data on 304', async () => {
    const firstFetch = makeFetch(200, [], '"etag-abc"');
    vi.stubGlobal('fetch', firstFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');

    // First call — populates cache
    const first = await client.getAssignedMRs();
    expect(first).toEqual([]);
    expect(firstFetch.mock.calls[0][1].headers['If-None-Match']).toBeUndefined();

    // Second call — should send ETag and receive 304
    const secondFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 304,
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', secondFetch);

    const second = await client.getAssignedMRs();
    expect(second).toEqual([]); // cached value returned
    expect(secondFetch.mock.calls[0][1].headers['If-None-Match']).toBe('"etag-abc"');
  });
});

describe('GitLabClient.getMRPipelineStatus', () => {
  it('returns the status of the most recent pipeline', async () => {
    const mockFetch = makeFetch(200, [{ status: 'success' }, { status: 'failed' }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    const status = await client.getMRPipelineStatus(10, 1);

    expect(status).toBe('success');
    expect(mockFetch.mock.calls[0][0] as string).toContain('/pipelines');
  });

  it('returns null when no pipelines exist', async () => {
    vi.stubGlobal('fetch', makeFetch(200, []));
    const client = new GitLabClient('https://gitlab.com', 'token');
    expect(await client.getMRPipelineStatus(10, 1)).toBeNull();
  });
});

describe('GitLabClient.approveMR', () => {
  it('POSTs to the approve endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 201,
      headers: { get: () => null },
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    await client.approveMR(10, 1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/approve');
    expect(opts.method).toBe('POST');
  });

  it('throws GitLabError with status 403 when scope is insufficient', async () => {
    vi.stubGlobal('fetch', makeFetch(403, 'Forbidden'));

    const client = new GitLabClient('https://gitlab.com', 'token');
    const err = await client.approveMR(10, 1).catch(e => e);

    expect(err).toBeInstanceOf(GitLabError);
    expect(err.status).toBe(403);
  });
});

describe('GitLabClient.postMRNote', () => {
  it('POSTs to the notes endpoint with the given body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 201,
      headers: { get: () => null },
      json: async () => ({ id: 99 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    await client.postMRNote(10, 1, 'Please fix the tests');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/notes');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string).body).toBe('Please fix the tests');
  });

  it('throws GitLabError with status 403 when scope is insufficient', async () => {
    vi.stubGlobal('fetch', makeFetch(403, 'Forbidden'));

    const client = new GitLabClient('https://gitlab.com', 'token');
    const err = await client.postMRNote(10, 1, 'comment').catch(e => e);

    expect(err).toBeInstanceOf(GitLabError);
    expect(err.status).toBe(403);
  });
});

describe('GitLabClient.getMRDiffs', () => {
  it('calls the /diffs endpoint', async () => {
    const mockFetch = makeFetch(200, [{ old_path: 'a.ts', new_path: 'a.ts', new_file: false, deleted_file: false }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new GitLabClient('https://gitlab.com', 'token');
    const diffs = await client.getMRDiffs(10, 1);

    expect(mockFetch.mock.calls[0][0] as string).toContain('/diffs');
    expect(diffs).toHaveLength(1);
  });

  it('falls back to /changes on 404', async () => {
    const changeEntry = { old_path: 'b.ts', new_path: 'b.ts', new_file: false, deleted_file: false };
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 404,
          headers: { get: () => null },
          text: async () => 'Not Found',
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => ({ changes: [changeEntry] }),
      });
    }));

    const client = new GitLabClient('https://gitlab.com', 'token');
    const diffs = await client.getMRDiffs(10, 1);

    expect(diffs).toEqual([changeEntry]);
  });
});
