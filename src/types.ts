export interface AccountItem {
  id: number;
  account: string;
  password: string;
  clientId: string | null;
  refreshToken: string | null;
  remark: string | null;
  createdAt: string;
}

export interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ line: number; raw: string; reason: string }>;
}

export type UploadMethod = 'POST' | 'PUT' | 'PATCH';

export interface UploadConfig {
  url: string;
  method: UploadMethod;
  contentType: string;
  headers: string;
  template: string;
  retryCount: number;
  concurrency: number;
  retryDelayMs: number;
}

export interface UploadResultDetail {
  id: number;
  account: string;
  ok: boolean;
  status: number;
  response: string;
  attempts: number;
}

export interface UploadResult {
  total: number;
  success: number;
  failure: number;
  details: UploadResultDetail[];
}

export interface AuthUser {
  username: string;
}
