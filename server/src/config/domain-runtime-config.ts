import { getProvisionedHosts } from './domains.js';
import { createCachedConfig } from './helpers.js';

export const getDomainRuntimeConfig = createCachedConfig(() => {
  const provisionedHosts = getProvisionedHosts(process.env.DOMAINS_JSON);

  return {
    provisionedHosts
  };
});
