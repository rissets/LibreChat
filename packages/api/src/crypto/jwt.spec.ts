import {
  AGENT_TRIGGER_SCOPE,
  generateAgentTriggerToken,
  generateRagToken,
  generateShortLivedToken,
  isAgentTriggerRequest,
} from './jwt';

function request(token: string, marker = true) {
  return {
    headers: {
      ...(marker && { 'x-lc-agent-trigger': '1' }),
      authorization: `Bearer ${token}`,
    },
  };
}

describe('agent trigger identity', () => {
  const original = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterAll(() => {
    if (original == null) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  });

  it('recognizes only a signed trigger scope with its transport marker', () => {
    const trigger = generateAgentTriggerToken('user-1');
    const ordinary = generateShortLivedToken('user-1');

    expect(isAgentTriggerRequest(request(trigger))).toBe(true);
    expect(isAgentTriggerRequest(request(trigger, false))).toBe(false);
    expect(isAgentTriggerRequest(request(ordinary))).toBe(false);
    expect(isAgentTriggerRequest(request('invalid'))).toBe(false);
  });

  it('uses the dedicated trigger scope without changing ordinary tokens', () => {
    const trigger = generateAgentTriggerToken('user-1');
    const payload = JSON.parse(Buffer.from(trigger.split('.')[1], 'base64url').toString()) as {
      id: string;
      scope: string;
    };

    expect(payload).toMatchObject({ id: 'user-1', scope: AGENT_TRIGGER_SCOPE });
    expect(generateShortLivedToken('user-1')).not.toBe(trigger);
  });
});

it('separates RAG workload tokens from browser and trigger tokens with a sixty second lifetime', () => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'fixture';
  try {
    const payload = JSON.parse(Buffer.from(generateRagToken('user-1').split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ id: 'user-1', scope: 'rag_workload', aud: 'librechat-rag' });
    expect(payload.exp - payload.iat).toBe(60);
  } finally { if (old) process.env.JWT_SECRET = old; else delete process.env.JWT_SECRET; }
});
