import mongoose, { Schema } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { applyGovernance, withGovernanceAccess } from '~/models/plugins/governance';
import { createGovernanceRepository } from './governance';

let server: MongoMemoryServer;
const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  const schema = new Schema({
    author: Schema.Types.ObjectId,
    name: String,
    version: Number,
    body: String,
    tenantId: String,
  });
  applyGovernance(schema);
  mongoose.model('Skill', schema);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

it('uses native skill object IDs, scopes metadata, and applies quarantine in its execution context', async () => {
  const Skill = mongoose.models.Skill;
  const row = await Skill.create({
    author: owner,
    name: 'synthetic',
    version: 3,
    body: 'private',
    tenantId: 'a',
  });
  await Skill.create({ author: other, name: 'other', tenantId: 'a' });
  const repo = createGovernanceRepository(mongoose);
  const rows = await repo.list('skills', String(owner), 'a', '', 10);
  expect(rows).toHaveLength(1);
  expect(rows[0].resource_id).toBe(String(row._id));
  expect(rows[0].body).toBeUndefined();
  expect(rows[0].version).toBe(3);
  expect(await repo.get('skills', String(other), 'a', String(row._id))).toBeNull();
  expect(await repo.quarantine('skills', String(owner), 'a', String(row._id), true, 0)).toBe(true);
  expect(await Skill.findById(row._id)).toBeNull();
  expect((await repo.list('skills', String(owner), 'a', '', 10))[0].governanceQuarantined).toBe(
    true,
  );
  expect(await repo.quarantine('skills', String(owner), 'a', String(row._id), false, 0)).toBe(
    false,
  );
  expect(await repo.quarantine('skills', String(owner), 'a', String(row._id), false, 1)).toBe(true);
  expect(await Skill.findById(row._id)).not.toBeNull();
});

it('ordinary writes cannot remove a quarantine, while audited inspection can read its content', async () => {
  const Skill = mongoose.models.Skill;
  const row = await withGovernanceAccess(() =>
    Skill.create({
      author: owner,
      name: 'quarantined',
      body: 'private',
      governanceQuarantined: true,
      tenantId: 'a',
    }),
  );
  await Skill.updateOne({ _id: row._id }, { $set: { governanceQuarantined: false } }).exec();
  const repo = createGovernanceRepository(mongoose);
  expect(await Skill.findById(row._id)).toBeNull();
  expect((await repo.get('skills', String(owner), 'a', String(row._id), true))?.body).toBe(
    'private',
  );
});
