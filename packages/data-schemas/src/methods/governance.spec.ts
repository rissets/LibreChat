import mongoose, { Schema } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { applyGovernance, withGovernanceAccess } from '~/models/plugins/governance';
import { createGovernanceRepository } from './governance';
import { tenantStorage } from '~/config/tenantContext';
import groupSchema from '~/schema/group';
import aclEntrySchema from '~/schema/aclEntry';
import { createUserGroupMethods } from './userGroup';
import { createAclEntryMethods } from './aclEntry';

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
  mongoose.model('Group', groupSchema);
  mongoose.model('AclEntry', aclEntrySchema);
  mongoose.model('User', new Schema({ idOnTheSource: String, role: String, tenantId: String }));
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

it('enforces an individual disable in native reads and aggregates without affecting other users', async () => {
  const Skill = mongoose.models.Skill;
  const row = await Skill.create({
    author: owner,
    name: 'individual',
    body: 'private',
    tenantId: 'a',
  });
  const repo = createGovernanceRepository(mongoose);
  expect(
    await repo.userState!('skills', String(owner), 'a', String(row._id), String(other), false, 0),
  ).toBe(true);
  await tenantStorage.run({ userId: String(other) }, async () => {
    expect(await Skill.findById(row._id)).toBeNull();
    expect(await Skill.aggregate([{ $match: { _id: row._id } }])).toHaveLength(0);
  });
  await tenantStorage.run({ userId: String(owner) }, async () => {
    expect(await Skill.findById(row._id)).not.toBeNull();
    const visible = await Skill.aggregate([{ $match: { _id: row._id } }]);
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toHaveProperty('governanceDisabledFor');
    await Skill.updateOne({ _id: row._id }, { $set: { governanceDisabledFor: [] } });
    await expect(
      Skill.updateOne({ _id: row._id }, [{ $set: { governanceDisabledFor: [] } }]),
    ).rejects.toThrow('GOVERNANCE_PIPELINE_WRITE_FORBIDDEN');
  });
  const updated = await repo.get('skills', String(owner), 'a', String(row._id));
  expect(updated?.governanceDisabledFor).toEqual([String(other)]);
  expect(
    await repo.userState!('skills', String(owner), 'a', String(row._id), String(other), true, 0),
  ).toBe(false);
  expect(
    await repo.userState!(
      'skills',
      String(owner),
      'a',
      String(row._id),
      String(other),
      true,
      Number(updated?.governanceRevision),
    ),
  ).toBe(true);
  await tenantStorage.run({ userId: String(other) }, async () =>
    expect(await Skill.findById(row._id)).not.toBeNull(),
  );
});

it('materializes managed assignments into native view/use ACL groups and preserves manual grants on revocation', async () => {
  const Skill = mongoose.models.Skill;
  await mongoose.models.User.create({ _id: owner, idOnTheSource: 'owner-source', tenantId: 'a' });
  await mongoose.models.User.create({ _id: other, tenantId: 'a' });
  const row = await Skill.create({ author: owner, name: 'assigned', tenantId: 'a' });
  const acl = createAclEntryMethods(mongoose);
  const groups = createUserGroupMethods(mongoose);
  const repo = createGovernanceRepository(mongoose, { ...acl, ...groups });
  const policy = '00000000-0000-4000-8000-000000000001';
  await tenantStorage.run({ tenantId: 'a' }, async () => {
    await repo.assign!(
      'skills',
      String(owner),
      'a',
      String(row._id),
      policy,
      [String(other)],
      true,
    );
    const principals = await groups.getUserPrincipals({ userId: String(other), role: null });
    expect(await acl.hasPermission(principals, 'skill', row._id, 1)).toBe(true);
    expect(await acl.hasPermission(principals, 'skill', row._id, 2)).toBe(false);
    expect(
      (await repo.available!('skills', String(other), 'a', '', 100)).some(
        (r) => r.resource_id === String(row._id),
      ),
    ).toBe(true);
    await acl.grantPermission('user', other, 'skill', row._id, 1, owner);
    await repo.assign!(
      'skills',
      String(owner),
      'a',
      String(row._id),
      policy,
      [String(other)],
      false,
    );
    const after = await groups.getUserPrincipals({ userId: String(other), role: null });
    expect(await acl.hasPermission(after, 'skill', row._id, 1)).toBe(true);
    expect(
      await mongoose.models.AclEntry.countDocuments({
        principalType: 'group',
        resourceId: row._id,
      }),
    ).toBe(0);
    expect(
      await mongoose.models.Group.countDocuments({ idOnTheSource: 'bpbatam:asset:' + policy }),
    ).toBe(1);
  });
});
