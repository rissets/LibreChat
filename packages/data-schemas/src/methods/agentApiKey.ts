import type { Types } from 'mongoose';
import type {
  AgentApiKeyCreateResult,
  AgentApiKeyCreateData,
  AgentApiKeyListItem,
  IAgentApiKey,
  AgentApiKeyUsage,
} from '~/types';
import { hashToken, getRandomValues } from '~/crypto';
import logger from '~/config/winston';

const API_KEY_PREFIX = 'sk-';
const API_KEY_LENGTH = 32;

export function createAgentApiKeyMethods(mongoose: typeof import('mongoose')): {
  createAgentApiKey: (data: AgentApiKeyCreateData) => Promise<AgentApiKeyCreateResult>;
  validateAgentApiKey: (
    apiKey: string,
  ) => Promise<{ userId: Types.ObjectId; keyId: Types.ObjectId } | null>;
  recordAgentApiKeyUsage: (
    keyId: string | Types.ObjectId,
    usage: AgentApiKeyUsage,
  ) => Promise<void>;
  listAgentApiKeys: (userId: string | Types.ObjectId) => Promise<AgentApiKeyListItem[]>;
  deleteAgentApiKey: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<boolean>;
  deleteAllAgentApiKeys: (userId: string | Types.ObjectId) => Promise<number>;
  getAgentApiKeyById: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<AgentApiKeyListItem | null>;
} {
  async function generateApiKey(): Promise<{ key: string; keyHash: string; keyPrefix: string }> {
    const randomPart = await getRandomValues(API_KEY_LENGTH);
    const key = `${API_KEY_PREFIX}${randomPart}`;
    const keyHash = await hashToken(key);
    const keyPrefix = key.slice(0, 8);
    return { key, keyHash, keyPrefix };
  }

  async function createAgentApiKey(data: AgentApiKeyCreateData): Promise<AgentApiKeyCreateResult> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const { key, keyHash, keyPrefix } = await generateApiKey();

      const apiKeyDoc = await AgentApiKey.create({
        userId: data.userId,
        name: data.name,
        keyHash,
        keyPrefix,
        expiresAt: data.expiresAt || undefined,
      });

      return {
        id: apiKeyDoc._id.toString(),
        name: apiKeyDoc.name,
        keyPrefix,
        key,
        createdAt: apiKeyDoc.createdAt,
        expiresAt: apiKeyDoc.expiresAt,
      };
    } catch (error) {
      logger.error('[createAgentApiKey] Error creating API key:', error);
      throw error;
    }
  }

  async function recordAgentApiKeyUsage(
    keyId: string | Types.ObjectId,
    usage: AgentApiKeyUsage,
  ): Promise<void> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const inputTokens = Math.max(0, Number(usage.inputTokens || 0));
      const outputTokens = Math.max(0, Number(usage.outputTokens || 0));
      const totalTokens = Math.max(
        0,
        Number(usage.totalTokens ?? inputTokens + outputTokens),
      );
      const statusCode = Number(usage.statusCode || 0);
      await AgentApiKey.updateOne(
        { _id: keyId },
        {
          $inc: {
            totalRequests: 1,
            successfulRequests: statusCode >= 200 && statusCode < 400 ? 1 : 0,
            failedRequests: statusCode >= 400 || statusCode === 0 ? 1 : 0,
            inputTokens,
            outputTokens,
            totalTokens,
          },
          $set: { lastUsedAt: new Date(), lastStatusCode: statusCode || undefined },
        },
      );
    } catch (error) {
      // Usage telemetry must never turn a successful API response into a failure.
      logger.warn('[recordAgentApiKeyUsage] Unable to persist usage:', error);
    }
  }

  async function validateAgentApiKey(
    apiKey: string,
  ): Promise<{ userId: Types.ObjectId; keyId: Types.ObjectId } | null> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keyHash = await hashToken(apiKey);

      const keyDoc = (await AgentApiKey.findOne({ keyHash }).lean()) as IAgentApiKey | null;

      if (!keyDoc) {
        return null;
      }

      if (keyDoc.expiresAt && new Date(keyDoc.expiresAt) < new Date()) {
        return null;
      }

      await AgentApiKey.updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() } });

      return {
        userId: keyDoc.userId,
        keyId: keyDoc._id as Types.ObjectId,
      };
    } catch (error) {
      logger.error('[validateAgentApiKey] Error validating API key:', error);
      return null;
    }
  }

  async function listAgentApiKeys(userId: string | Types.ObjectId): Promise<AgentApiKeyListItem[]> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keys = (await AgentApiKey.find({ userId })
        .sort({ createdAt: -1 })
        .lean()) as unknown as IAgentApiKey[];

      return keys.map((key) => ({
        id: (key._id as Types.ObjectId).toString(),
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
        totalRequests: key.totalRequests || 0,
        successfulRequests: key.successfulRequests || 0,
        failedRequests: key.failedRequests || 0,
        inputTokens: key.inputTokens || 0,
        outputTokens: key.outputTokens || 0,
        totalTokens: key.totalTokens || 0,
        lastStatusCode: key.lastStatusCode,
      }));
    } catch (error) {
      logger.error('[listAgentApiKeys] Error listing API keys:', error);
      throw error;
    }
  }

  async function deleteAgentApiKey(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<boolean> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const result = await AgentApiKey.deleteOne({ _id: keyId, userId });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('[deleteAgentApiKey] Error deleting API key:', error);
      throw error;
    }
  }

  async function deleteAllAgentApiKeys(userId: string | Types.ObjectId): Promise<number> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const result = await AgentApiKey.deleteMany({ userId });
      return result.deletedCount;
    } catch (error) {
      logger.error('[deleteAllAgentApiKeys] Error deleting all API keys:', error);
      throw error;
    }
  }

  async function getAgentApiKeyById(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<AgentApiKeyListItem | null> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keyDoc = (await AgentApiKey.findOne({
        _id: keyId,
        userId,
      }).lean()) as IAgentApiKey | null;

      if (!keyDoc) {
        return null;
      }

      return {
        id: (keyDoc._id as Types.ObjectId).toString(),
        name: keyDoc.name,
        keyPrefix: keyDoc.keyPrefix,
        lastUsedAt: keyDoc.lastUsedAt,
        expiresAt: keyDoc.expiresAt,
        createdAt: keyDoc.createdAt,
        totalRequests: keyDoc.totalRequests || 0,
        successfulRequests: keyDoc.successfulRequests || 0,
        failedRequests: keyDoc.failedRequests || 0,
        inputTokens: keyDoc.inputTokens || 0,
        outputTokens: keyDoc.outputTokens || 0,
        totalTokens: keyDoc.totalTokens || 0,
        lastStatusCode: keyDoc.lastStatusCode,
      };
    } catch (error) {
      logger.error('[getAgentApiKeyById] Error getting API key:', error);
      throw error;
    }
  }

  return {
    createAgentApiKey,
    validateAgentApiKey,
    recordAgentApiKeyUsage,
    listAgentApiKeys,
    deleteAgentApiKey,
    deleteAllAgentApiKeys,
    getAgentApiKeyById,
  };
}

export type AgentApiKeyMethods = ReturnType<typeof createAgentApiKeyMethods>;
