import pg from 'pg';

import { getDatabaseConfig } from '../config/database-config.js';

const { Pool } = pg;
const databaseConfig = getDatabaseConfig();

export const pool = new Pool({
  ...('connectionString' in databaseConfig
    ? {
        connectionString: databaseConfig.connectionString,
        ssl: databaseConfig.ssl ? { rejectUnauthorized: true } : undefined
      }
    : {
        host: databaseConfig.host,
        port: databaseConfig.port,
        database: databaseConfig.database,
        user: databaseConfig.user,
        password: databaseConfig.password,
        ssl: databaseConfig.ssl ? { rejectUnauthorized: true } : undefined
      })
});
