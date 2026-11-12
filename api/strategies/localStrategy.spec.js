const { passportLogin } = require('./localStrategy');
const { comparePassword, grandfatherLegacyEmailVerification } = require('@librechat/api');
const { findUsers, findUser, updateUser } = require('~/models');

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn((val) => val === 'true'),
  comparePassword: jest.fn(),
  grandfatherLegacyEmailVerification: jest.fn(),
  compareSecret: 'mock-compare-secret',
}));

jest.mock('~/models', () => ({
  findUser: jest.fn(),
  findUsers: jest.fn(),
  updateUser: jest.fn(),
}));

describe('localStrategy - passportLogin', () => {
  const originalEnv = { ...process.env };
  const mockReq = {
    ip: '127.0.0.1',
    body: {
      email: 'testuser',
      password: 'password123',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    grandfatherLegacyEmailVerification.mockResolvedValue(true);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('authenticates successfully using a valid email and password', async () => {
    const user = {
      _id: 'user-id-1',
      email: 'test@example.com',
      username: 'testuser',
      password: 'hashed-password',
      emailVerified: true,
    };

    findUsers.mockResolvedValue([user]);
    comparePassword.mockResolvedValue(true);

    const done = jest.fn();
    const req = {
      ip: '127.0.0.1',
      body: {
        email: 'test@example.com',
        password: 'password123',
      },
    };

    await passportLogin(req, 'test@example.com', 'password123', done);

    expect(findUsers).toHaveBeenCalledWith(
      {
        $or: [
          { email: 'test@example.com' },
          { username: 'test@example.com' },
        ],
      },
      '+password',
    );
    expect(comparePassword).toHaveBeenCalledWith(user, 'password123', {
      compare: 'mock-compare-secret',
    });
    expect(done).toHaveBeenCalledWith(null, user);
  });

  it('authenticates successfully using a username and password for local user', async () => {
    const user = {
      _id: 'user-id-2',
      username: 'bpbatam_admin',
      email: 'admin@bpbatam.go.id',
      password: 'hashed-password',
      emailVerified: true,
    };

    findUsers.mockResolvedValue([user]);
    comparePassword.mockResolvedValue(true);

    const done = jest.fn();
    const req = {
      ip: '127.0.0.1',
      body: {
        email: 'bpbatam_admin',
        password: 'password123',
      },
    };

    await passportLogin(req, 'bpbatam_admin', 'password123', done);

    expect(findUsers).toHaveBeenCalledWith(
      {
        $or: [
          { email: 'bpbatam_admin' },
          { username: 'bpbatam_admin' },
        ],
      },
      '+password',
    );
    expect(done).toHaveBeenCalledWith(null, user);
  });

  it('rejects authentication when password does not match', async () => {
    const user = {
      _id: 'user-id-3',
      username: 'bpbatam_user',
      email: 'user@bpbatam.go.id',
      password: 'hashed-password',
      emailVerified: true,
    };

    findUsers.mockResolvedValue([user]);
    comparePassword.mockResolvedValue(false);

    const done = jest.fn();
    await passportLogin(mockReq, 'bpbatam_user', 'wrongpassword', done);

    expect(done).toHaveBeenCalledWith(null, false, { message: 'Incorrect password.' });
  });

  it('rejects authentication with ambiguous identity when multiple users match', async () => {
    const user1 = {
      _id: 'user-id-4a',
      username: 'operator',
      email: 'other@example.com',
      password: 'hashed-password',
    };
    const user2 = {
      _id: 'user-id-4b',
      username: 'other_user',
      email: 'operator',
      password: 'hashed-password',
    };

    findUsers.mockResolvedValue([user1, user2]);

    const done = jest.fn();
    await passportLogin(mockReq, 'operator', 'password123', done);

    expect(comparePassword).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, false, { message: 'Ambiguous identity.' });
  });

  it('rejects authentication when no user matches the identifier', async () => {
    findUsers.mockResolvedValue([]);

    const done = jest.fn();
    await passportLogin(mockReq, 'nonexistent', 'password123', done);

    expect(comparePassword).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, false, { message: 'Email does not exist.' });
  });

  it('rejects authentication when the user document has no password', async () => {
    const user = {
      _id: 'user-id-5',
      username: 'nopassword_user',
      email: 'nopass@example.com',
      password: null,
    };

    findUsers.mockResolvedValue([user]);

    const done = jest.fn();
    await passportLogin(mockReq, 'nopassword_user', 'password123', done);

    expect(comparePassword).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, false, { message: 'Email does not exist.' });
  });

  it('rejects validation when password is too short', async () => {
    const done = jest.fn();
    const req = {
      ip: '127.0.0.1',
      body: {
        email: 'testuser',
        password: 'sh',
      },
    };

    await passportLogin(req, 'testuser', 'sh', done);

    expect(findUsers).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(
      null,
      false,
      expect.objectContaining({
        message: expect.any(String),
      }),
    );
  });

  it('blocks unverified email user when unverified login is disabled', async () => {
    const user = {
      _id: 'user-id-6',
      username: 'unverified_user',
      email: 'unverified@example.com',
      password: 'hashed-password',
      emailVerified: false,
    };

    findUsers.mockResolvedValue([user]);
    comparePassword.mockResolvedValue(true);
    process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN = 'false';

    const done = jest.fn();
    await passportLogin(mockReq, 'unverified_user', 'password123', done);

    expect(done).toHaveBeenCalledWith(null, user, { message: 'Email not verified.' });
  });

  it('allows user without email to log in even if emailVerified is false', async () => {
    const user = {
      _id: 'user-id-7',
      username: 'admin_no_email',
      email: null,
      password: 'hashed-password',
      emailVerified: false,
    };

    findUsers.mockResolvedValue([user]);
    comparePassword.mockResolvedValue(true);
    process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN = 'false';

    const done = jest.fn();
    await passportLogin(mockReq, 'admin_no_email', 'password123', done);

    expect(done).toHaveBeenCalledWith(null, user);
  });
});
