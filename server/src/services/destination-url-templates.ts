const destinationUrlTemplatePattern =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]{0,63})\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;
const destinationUrlTemplateSampleValues = ['value', 'value.example.com', 'https://example.com'];

type DestinationUrlTemplateResolution =
  | {
      kind: 'resolved';
      url: string;
    }
  | {
      kind: 'missing-required-variable';
      variableKey: string;
    }
  | {
      kind: 'invalid';
    };

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function hasWellFormedDestinationUrlTemplates(destinationUrl: string) {
  const strippedValue = destinationUrl.replace(destinationUrlTemplatePattern, '');
  return !strippedValue.includes('{{') && !strippedValue.includes('}}');
}

function replaceDestinationUrlTemplates(
  destinationUrl: string,
  resolveValue: (key: string, fallbackValue: string | null) => string
) {
  return destinationUrl.replace(
    destinationUrlTemplatePattern,
    (_match, key: string, fallbackValue?: string) =>
      resolveValue(key.toLowerCase(), fallbackValue !== undefined ? fallbackValue.trim() : null)
  );
}

export function isConfiguredDestinationUrl(destinationUrl: string) {
  if (!hasWellFormedDestinationUrlTemplates(destinationUrl)) {
    return false;
  }

  return destinationUrlTemplateSampleValues.some((sampleValue) =>
    isAbsoluteUrl(
      replaceDestinationUrlTemplates(
        destinationUrl,
        (_key, fallbackValue) => fallbackValue ?? sampleValue
      )
    )
  );
}

export function resolveDestinationUrlForUser(
  destinationUrl: string,
  userVariables: Record<string, string>
): DestinationUrlTemplateResolution {
  let missingRequiredVariableKey: string | null = null;
  const resolvedUrl = replaceDestinationUrlTemplates(
    destinationUrl,
    (key, fallbackValue) => {
      const userValue = userVariables[key];
      if (typeof userValue === 'string') {
        return userValue;
      }

      if (fallbackValue !== null) {
        return fallbackValue;
      }

      missingRequiredVariableKey ??= key;
      return '';
    }
  );

  if (missingRequiredVariableKey) {
    return {
      kind: 'missing-required-variable',
      variableKey: missingRequiredVariableKey
    };
  }

  if (isAbsoluteUrl(resolvedUrl)) {
    return {
      kind: 'resolved',
      url: resolvedUrl
    };
  }

  const fallbackUrl = replaceDestinationUrlTemplates(
    destinationUrl,
    (_key, fallbackValue) => fallbackValue ?? ''
  );

  if (isAbsoluteUrl(fallbackUrl)) {
    return {
      kind: 'resolved',
      url: fallbackUrl
    };
  }

  return {
    kind: 'invalid'
  };
}

export function normalizeLinkVariables(
  variables: Array<{ key: string; value: string }>
): Record<string, string> {
  const normalizedEntries = variables
    .map((variable) => ({
      key: variable.key.trim().toLowerCase(),
      value: variable.value.trim()
    }))
    .filter((variable) => variable.key.length > 0 && variable.value.length > 0)
    .sort((left, right) => left.key.localeCompare(right.key));

  return Object.fromEntries(normalizedEntries.map((variable) => [variable.key, variable.value]));
}

export function serializeLinkVariables(linkVariables: Record<string, string>) {
  return Object.entries(linkVariables)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].trim().length > 0 && typeof entry[1] === 'string' && entry[1].trim().length > 0
    )
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ({
      key,
      value
    }));
}
