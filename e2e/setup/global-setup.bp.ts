import { FullConfig } from '@playwright/test';
import authenticate from './authenticate';
import { getE2EUser } from './user';
import { verifyBpProviders } from './provider-preflight';

async function globalSetup(config: FullConfig) {
  await verifyBpProviders();
  await authenticate(config, getE2EUser());
}

export default globalSetup;
