import { Pool } from 'pg';

const DATABASE_URL: string = process.env.DATABASE_URL || 'postgres://draw:draw@localhost:5432/draw';
const queryTimeout: number = Number(process.env.DB_QUERY_TIMEOUT || 10000);

export const pool: Pool = new Pool({
  connectionString: DATABASE_URL,
  query_timeout: queryTimeout,
});
