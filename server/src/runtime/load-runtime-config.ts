import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});
let loadPromise: Promise<void> | null = null;

function getSecretCandidates(secretId: string) {
  const candidates = [secretId];

  if (secretId.includes(':secret:')) {
    const secretName = secretId.split(':secret:')[1];
    if (secretName && secretName !== secretId) {
      candidates.push(secretName);
    }
  }

  return candidates;
}

async function getSecretString(secretId: string) {
  let lastError: unknown = null;
  const candidates = getSecretCandidates(secretId);

  for (const [index, candidate] of candidates.entries()) {
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: candidate
        })
      );

      if (response.SecretString) {
        return response.SecretString;
      }

      if (response.SecretBinary) {
        return Buffer.from(response.SecretBinary).toString('utf8');
      }

      throw new Error(`Secret ${candidate} did not contain a string or binary payload.`);
    } catch (error) {
      lastError = error;

      if (
        !(error instanceof Error) ||
        error.name !== 'ResourceNotFoundException' ||
        index === candidates.length - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to read secret ${secretId} from Secrets Manager.`);
}

export async function loadRuntimeConfig() {
  if (loadPromise) {
    return await loadPromise;
  }

  loadPromise = (async () => {
    if (!process.env.JWT_SECRET && process.env.JWT_SECRET_ID) {
      process.env.JWT_SECRET = await getSecretString(process.env.JWT_SECRET_ID);
    }

    if (
      !process.env.DATABASE_URL &&
      (!process.env.DATABASE_USER || !process.env.DATABASE_PASSWORD) &&
      process.env.DATABASE_SECRET_ID
    ) {
      const rawSecret = await getSecretString(process.env.DATABASE_SECRET_ID);
      const parsedSecret = JSON.parse(rawSecret) as {
        username?: unknown;
        password?: unknown;
      };

      if (typeof parsedSecret.username !== 'string' || typeof parsedSecret.password !== 'string') {
        throw new Error(
          `Secret ${process.env.DATABASE_SECRET_ID} must contain string username and password fields.`
        );
      }

      process.env.DATABASE_USER = parsedSecret.username;
      process.env.DATABASE_PASSWORD = parsedSecret.password;
    }
  })();

  return await loadPromise;
}
