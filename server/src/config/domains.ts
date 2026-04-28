import { parseProvisionedHosts } from '../../../domain-config/index.js';

export function getProvisionedHosts(rawValue: string | undefined): string[] {
  return parseProvisionedHosts(rawValue, { variableName: 'DOMAINS_JSON' });
}
