import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabClient } from './client';

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

describe('GitLabClient error handling', () => {
  it('throws with status code in message on non-2xx response', async () => {
    vi.stubGlobal('fetch', makeFetch(401, 'Unauthorized'));

    const client = new GitLabClient('https://gitlab.com', 'bad-token');
    await expect(client.getCurrentUser()).rejects.toThrow('GitLab API 401');
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
