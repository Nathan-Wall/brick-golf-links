const HOST_CONFIG_EXAMPLE = '["go.example.com","go.alt-example.com"]';

function fail(variableName, message) {
  throw new Error(`${variableName} ${message}`);
}

function normalizeHost(rawHost, variableName, source) {
  if (typeof rawHost !== 'string' || rawHost.trim().length === 0) {
    fail(variableName, `must contain non-empty string hosts. Invalid host in ${source}.`);
  }

  return rawHost.trim().toLowerCase();
}

function registerHost(hosts, seenHosts, variableName, rawHost, source) {
  const host = normalizeHost(rawHost, variableName, source);
  const existingSource = seenHosts.get(host);
  if (existingSource) {
    fail(variableName, `contains duplicate host "${host}" in ${existingSource} and ${source}.`);
  }

  seenHosts.set(host, source);
  hosts.push(host);
}

function registerLegacyObjectHosts(hosts, seenHosts, variableName, input, index) {
  const candidate = input;
  if (typeof candidate.host !== 'string' || candidate.host.trim().length === 0) {
    fail(variableName, `must contain objects with a non-empty string host at index ${index}.`);
  }

  registerHost(hosts, seenHosts, variableName, candidate.host, `legacy host at index ${index}`);

  if (candidate.aliases === undefined) {
    return;
  }

  if (
    !Array.isArray(candidate.aliases) ||
    candidate.aliases.some((alias) => typeof alias !== 'string' || alias.trim().length === 0)
  ) {
    fail(variableName, `must contain aliases as an array of non-empty strings at index ${index}.`);
  }

  candidate.aliases.forEach((alias, aliasIndex) => {
    registerHost(
      hosts,
      seenHosts,
      variableName,
      alias,
      `legacy alias at index ${index}:${aliasIndex}`
    );
  });
}

export function parseProvisionedHosts(rawValue, options = {}) {
  const variableName = options.variableName ?? 'DOMAINS_JSON';

  if (!rawValue?.trim()) {
    fail(variableName, `must be set to a JSON array of host strings shaped like ${HOST_CONFIG_EXAMPLE}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    fail(variableName, `must be valid JSON. ${error instanceof Error ? error.message : 'Invalid value.'}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(variableName, `must be a non-empty JSON array shaped like ${HOST_CONFIG_EXAMPLE}.`);
  }

  const hosts = [];
  const seenHosts = new Map();

  parsed.forEach((item, index) => {
    if (typeof item === 'string') {
      registerHost(hosts, seenHosts, variableName, item, `index ${index}`);
      return;
    }

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      // Accept the old object-based shape so existing deploy config keeps working
      // while the runtime model moves to provisioned-host-only configuration.
      registerLegacyObjectHosts(hosts, seenHosts, variableName, item, index);
      return;
    }

    fail(
      variableName,
      `must be a JSON array of host strings shaped like ${HOST_CONFIG_EXAMPLE}. Invalid item at index ${index}.`
    );
  });

  return hosts;
}
