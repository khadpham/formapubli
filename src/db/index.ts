import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const dbUrl = process.env.DATABASE_URL || 'file:formapubli.db';
const clientConfig = {
  url: dbUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
};

const client = createClient(clientConfig);

// Với protocol 'file:', @libsql/client tái sử dụng internal connection. Khi một BEGIN IMMEDIATE
// gặp SQLITE_BUSY, statement chưa finalized sẽ gây lỗi 'cannot commit transaction - SQL statements in progress'
// ở mọi lần retry tiếp theo. Gán client.transaction tạo connection riêng cho mỗi transaction đảm bảo retry an toàn.
if (client.protocol === 'file') {
  client.transaction = async function (mode: any = 'write') {
    const txClient = createClient(clientConfig);
    return await txClient.transaction(mode);
  };
}

export const db = drizzle(client, { schema });
export * from './schema';
