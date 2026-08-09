export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  active: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginPayload {
  email?: string;
  username?: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  username?: string;
  email: string;
  password: string;
}

export interface UpdateUserPayload {
  name?: string;
  username?: string;
  email?: string;
  githubToken?: string;
}

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  updatedAt: string;
  defaultBranch: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  user: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface ApiErrorBody {
  message: string | string[];
  error?: string;
  statusCode: number;
}
