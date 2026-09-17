import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const dbUrl = process.env.DATABASE_URL || 'file:formapubli.db';
const clientConfig = {
  url: dbUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
};

const client = createClient(clientConfig);

// Cấu hình busy_timeout trên client gốc để mọi câu truy vấn ngoài transaction (SELECT, etc.)
// tự động chờ SQLite lock lên đến 5.000ms trước khi trả về SQLITE_BUSY.
if (client.protocol === 'file') {
  client.execute('PRAGMA busy_timeout = 5000;').catch(() => {});
}

// Với protocol 'file:', @libsql/client tái sử dụng internal connection. Khi một BEGIN IMMEDIATE
// gặp SQLITE_BUSY, statement chưa finalized sẽ gây lỗi 'cannot commit transaction - SQL statements in progress'
// ở mọi lần retry tiếp theo. Gán client.transaction tạo connection riêng cho mỗi transaction đảm bảo retry an toàn.
if (client.protocol === 'file') {
  client.transaction = async function (mode: any = 'write') {
    const txClient = createClient(clientConfig);
    try {
      await txClient.execute('PRAGMA busy_timeout = 5000;');
      return await txClient.transaction(mode);
    } catch (err) {
      try {
        txClient.close();
      } catch {}
      throw err;
    }
  };
}

export const db = drizzle(client, { schema });
export * from './schema';
