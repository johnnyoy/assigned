import * as vscode from 'vscode';

const TOKEN_KEY = 'assigned.gitlabToken';

export interface Config {
  gitlabUrl: string;
  pollIntervalMinutes: number;
}

export function getConfig(): Config {
  const cfg = vscode.workspace.getConfiguration('assigned');
  return {
    gitlabUrl: (cfg.get<string>('gitlabUrl') || 'https://gitlab.com').replace(/\/$/, ''),
    pollIntervalMinutes: cfg.get<number>('pollIntervalMinutes') || 10,
  };
}

export async function getToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(TOKEN_KEY);
}

export async function saveToken(secrets: vscode.SecretStorage, token: string): Promise<void> {
  await secrets.store(TOKEN_KEY, token);
}

export async function clearToken(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(TOKEN_KEY);
}

export async function configure(secrets: vscode.SecretStorage): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('assigned');

  const gitlabUrl = await vscode.window.showInputBox({
    prompt: 'GitLab instance URL',
    value: cfg.get<string>('gitlabUrl') || 'https://gitlab.com',
    ignoreFocusOut: true,
  });
  if (!gitlabUrl) return false;
  await cfg.update('gitlabUrl', gitlabUrl.replace(/\/$/, ''), vscode.ConfigurationTarget.Global);

  const token = await vscode.window.showInputBox({
    prompt: 'GitLab Personal Access Token (scope: read_api)',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return false;
  await saveToken(secrets, token);

  return true;
}
