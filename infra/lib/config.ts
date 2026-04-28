import { parseProvisionedHosts } from '../../domain-config/index.js';

export function parseProvisionedHostsFromEnv(): string[] {
  return parseProvisionedHosts(process.env.DOMAINS_JSON, { variableName: 'DOMAINS_JSON' });
}

export function parseJsonStringArray(name: string) {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} must be set.`);
  }

  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }

  return value;
}

export type HostedZoneConfig = {
  hostedZoneId: string;
  zoneName: string;
};

function parseCertificateArnMap(rawMap: string, hosts: string[], variableName: string) {
  const parsed = JSON.parse(rawMap) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${variableName} must be a JSON object keyed by host.`);
  }

  const certificateArns = parsed as Record<string, unknown>;
  for (const host of hosts) {
    if (typeof certificateArns[host] !== 'string' || certificateArns[host].trim().length === 0) {
      throw new Error(`${variableName} is missing a certificate ARN for ${host}.`);
    }
  }

  return certificateArns as Record<string, string>;
}

function pickHostedZoneName(host: string, zoneIds: Record<string, string>) {
  const hostedZoneId = zoneIds[host];
  const candidates = Object.entries(zoneIds)
    .filter(
      ([candidateHost, candidateZoneId]) =>
        candidateZoneId === hostedZoneId &&
        (candidateHost === host || host.endsWith(`.${candidateHost}`))
    )
    .map(([candidateHost]) => candidateHost)
    .sort((left, right) => {
      const leftLabels = left.split('.').length;
      const rightLabels = right.split('.').length;
      return leftLabels - rightLabels || left.localeCompare(right);
    });

  return candidates[0] ?? host;
}

export function parseHostedZones(hosts: string[]) {
  const raw = process.env.APP_HOSTED_ZONE_IDS_JSON;
  if (!raw) {
    throw new Error('APP_HOSTED_ZONE_IDS_JSON must be set.');
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('APP_HOSTED_ZONE_IDS_JSON must be a JSON object keyed by host.');
  }

  const zoneIds = parsed as Record<string, unknown>;
  for (const host of hosts) {
    if (typeof zoneIds[host] !== 'string' || zoneIds[host].length === 0) {
      throw new Error(`APP_HOSTED_ZONE_IDS_JSON is missing a hosted zone id for ${host}.`);
    }
  }

  const normalizedZoneIds = zoneIds as Record<string, string>;

  return Object.fromEntries(
    hosts.map((host) => [
      host,
      {
        hostedZoneId: normalizedZoneIds[host],
        zoneName: pickHostedZoneName(host, normalizedZoneIds)
      }
    ])
  ) as Record<string, HostedZoneConfig>;
}

export function parseCertificateArns(hosts: string[]) {
  const rawMap = process.env.APP_CERTIFICATE_ARNS_JSON;
  if (rawMap) {
    return parseCertificateArnMap(rawMap, hosts, 'APP_CERTIFICATE_ARNS_JSON');
  }

  const rawSingle = process.env.APP_CERTIFICATE_ARN;
  if (!rawSingle) {
    throw new Error('APP_CERTIFICATE_ARNS_JSON or APP_CERTIFICATE_ARN must be set.');
  }

  return Object.fromEntries(hosts.map((host) => [host, rawSingle]));
}

export function parseEdgeCertificateArns(
  hosts: string[],
  fallbackCertificateArns: Record<string, string>
) {
  const rawMap = process.env.APP_EDGE_CERTIFICATE_ARNS_JSON;
  if (!rawMap) {
    return fallbackCertificateArns;
  }

  return parseCertificateArnMap(rawMap, hosts, 'APP_EDGE_CERTIFICATE_ARNS_JSON');
}
