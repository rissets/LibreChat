import { Document, Types } from 'mongoose';

export interface IAgentApiKey extends Document {
  userId: Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix: string;
  lastUsedAt?: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastStatusCode?: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

export interface AgentApiKeyCreateData {
  userId: Types.ObjectId | string;
  name: string;
  expiresAt?: Date | null;
}

export interface AgentApiKeyCreateResult {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface AgentApiKeyUsage {
  statusCode: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastStatusCode?: number;
}

export interface AgentApiKeyQuery {
  userId?: Types.ObjectId | string;
  keyPrefix?: string;
  id?: string;
}

export interface AgentApiKeyDeleteResult {
  deletedCount?: number;
}
