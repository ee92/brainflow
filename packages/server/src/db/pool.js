import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://draw:draw@localhost:5432/draw';
const queryTimeout = Number(process.env.DB_QUERY_TIMEOUT || 10000);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  query_timeout: queryTimeout,
});
