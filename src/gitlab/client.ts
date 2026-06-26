import * as vscode from 'vscode';
import { getConfig, getToken } from '../config';

export interface MR {
  id: number;
  iid: number;
  title: string;
  author: { name: string; username: string };
  source_branch: string;
  target_branch: string;
  web_url: string;
  project_id: number;
  references: { full: string };
  work_in_progress: boolean;
  has_conflicts: boolean;
  upvotes: number;
}

export type PipelineStatus =
  | 'success' | 'failed' | 'running' | 'pending'
  | 'canceled' | 'skipped' | 'created'
  | 'waiting_for_resource' | 'preparing' | 'scheduled';

export type MRRole = 'assigned' | 'reviewer';
export interface TaggedMR extends MR { role: MRRole; pipelineStatus?: PipelineStatus; }

export interface MRChange {
  old_path: string;
  new_path: string;
  new_file: boolean;
  deleted_file: boolean;
}

interface MRDetail extends MR {
  changes: MRChange[];
}

export interface Project {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
}

interface ETagEntry {
  etag: string;
  data: MR[];
}

export class GitLabError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitLabError';
  }
}

export class GitLabClient {
  private baseUrl: string;
  private token: string;
  private etagCache = new Map<string, ETagEntry>();

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async get<T>(path: string, useEtag = false): Promise<T | null> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    if (useEtag) {
      const cached = this.etagCache.get(url);
      if (cached) {
        headers['If-None-Match'] = cached.etag;
      }
    }

    const response = await fetch(url, { headers });

    if (response.status === 304 && useEtag) {
      const cached = this.etagCache.get(url);
      return cached ? (cached.data as unknown as T) : null;
    }

    if (!response.ok) {
      throw new GitLabError(`GitLab API ${response.status} for ${path}`, response.status);
    }

    const data = await response.json() as T;
    const etag = response.headers.get('etag');

    if (useEtag && etag && Array.isArray(data)) {
      this.etagCache.set(url, { etag, data: data as unknown as MR[] });
    }

    return data;
  }

  async getCurrentUser(): Promise<{ id: number; username: string }> {
    const data = await this.get<{ id: number; username: string }>('/user');
    if (!data) throw new Error('Failed to get current user');
    return data;
  }

  async getAssignedMRs(userId?: number): Promise<MR[]> {
    const assigneeParam = userId ? `assignee_id=${userId}` : 'assignee_id=me';
    const data = await this.get<MR[]>(
      `/merge_requests?${assigneeParam}&state=opened&scope=all&per_page=50`,
      true
    );
    return data ?? [];
  }

  async getReviewRequestedMRs(userId?: number): Promise<MR[]> {
    const param = userId ? `reviewer_id=${userId}` : 'reviewer_id=me';
    const data = await this.get<MR[]>(
      `/merge_requests?${param}&state=opened&scope=all&per_page=50`,
      true
    );
    return data ?? [];
  }

  async getMRDiffs(projectId: number, mrIid: number): Promise<MRChange[]> {
    try {
      const data = await this.get<MRChange[]>(
        `/projects/${projectId}/merge_requests/${mrIid}/diffs?per_page=100`
      );
      return data ?? [];
    } catch (err) {
      // Fall back to deprecated /changes endpoint for GitLab < 15.7
      if (err instanceof GitLabError && err.status === 404) {
        const detail = await this.get<MRDetail>(
          `/projects/${projectId}/merge_requests/${mrIid}/changes`
        );
        return detail?.changes ?? [];
      }
      throw err;
    }
  }

  async getProject(projectId: number): Promise<Project> {
    const data = await this.get<Project>(`/projects/${encodeURIComponent(projectId)}`);
    if (!data) throw new Error('Failed to fetch project');
    return data;
  }

  async getMRPipelineStatus(projectId: number, mrIid: number): Promise<PipelineStatus | null> {
    const data = await this.get<Array<{ status: PipelineStatus }>>(
      `/projects/${projectId}/merge_requests/${mrIid}/pipelines?per_page=1`
    );
    return data && data.length > 0 ? data[0].status : null;
  }

  async approveMR(projectId: number, mrIid: number): Promise<void> {
    await this.post(`/projects/${projectId}/merge_requests/${mrIid}/approve`);
  }

  async postMRNote(projectId: number, mrIid: number, body: string): Promise<void> {
    await this.post(`/projects/${projectId}/merge_requests/${mrIid}/notes`, { body });
  }

  private async post<T>(path: string, body?: unknown): Promise<T | null> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new GitLabError(`GitLab API ${response.status} for POST ${path}`, response.status);
    }
    if (response.status === 204) return null;
    return response.json() as Promise<T>;
  }
}

export async function createClient(secrets: vscode.SecretStorage): Promise<GitLabClient | null> {
  const { gitlabUrl } = getConfig();
  const token = await getToken(secrets);
  if (!token) return null;
  return new GitLabClient(gitlabUrl, token);
}
