import { matchesVietnameseSearch, removeAccents, generateAcronym } from '../src/lib/vietnamese';
import { db, editions, works } from '../src/db';
import { eq } from 'drizzle-orm';

async function runVietnameseSearchTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 KIỂM THỬ TÌM KIẾM TIẾNG VIỆT KHÔNG DẤU (81 ĐẦU SÁCH)');
  console.log('🧪 ========================================================\n');

  // Lấy toàn bộ sách từ CSDL
  const allBooks = await db
    .select({
      code: editions.code,
      title: editions.title,
      isbn: editions.isbn,
      isbnLast4: editions.isbnLast4,
      author: works.author,
      translator: works.translator,
      shortCode: works.shortCode,
    })
    .from(editions)
    .innerJoin(works, eq(editions.workId, works.id));

  console.log(`📚 Đã nạp ${allBooks.length} ấn bản từ CSDL để kiểm thử tìm kiếm.\n`);

  function search(query: string) {
    return allBooks.filter((b) => {
      const q = query.trim().toLowerCase();
      // 1. Khớp 4 số cuối hoặc toàn bộ ISBN
      if (b.isbnLast4.includes(q) || b.isbn.includes(q)) return true;
      // 2. Khớp mã SKU (H01, H02...)
      if (b.code.toLowerCase().includes(q)) return true;
      // 3. Khớp mã viết tắt (bt, nbl, dddhc...)
      if (b.shortCode && b.shortCode.toLowerCase() === q) return true;
      // 4. Khớp tiếng Việt không dấu trên Tên sách
      if (matchesVietnameseSearch(b.title, q)) return true;
      // 5. Khớp tiếng Việt không dấu trên Tác giả
      if (matchesVietnameseSearch(b.author, q)) return true;
      // 6. Khớp tiếng Việt không dấu trên Dịch giả
      if (matchesVietnameseSearch(b.translator, q)) return true;

      return false;
    });
  }

  const testCases = [
    {
      query: 'truong',
      expectedTitles: ['Trưởng giả học làm sang'],
      desc: 'Tìm kiếm không dấu "truong" phải ra "Trưởng giả học làm sang"',
    },
    {
      query: 'benh',
      expectedTitles: ['Bệnh tưởng'],
      desc: 'Tìm kiếm không dấu "benh" phải ra "Bệnh tưởng"',
    },
    {
      query: 'nguoi',
      expectedTitles: ['Người biển lận'],
      desc: 'Tìm kiếm không dấu "nguoi" phải ra "Người biển lận"',
    },
    {
      query: 'duong duong',
      expectedTitles: ['Dưỡng đường đồng hồ cát'],
      desc: 'Tìm kiếm không dấu "duong duong" phải ra "Dưỡng đường đồng hồ cát"',
    },
    {
      query: 'dun cat',
      expectedTitles: ['Một câu chuyện từ những đụn cát'],
      desc: 'Tìm kiếm không dấu "dun cat" phải ra "Một câu chuyện từ những đụn cát"',
    },
    {
      query: 'moliere',
      expectedCountAtLeast: 3,
      desc: 'Tìm kiếm không dấu tác giả "moliere" phải ra ít nhất 3 vở kịch',
    },
    {
      query: 'cao viet dung',
      expectedCountAtLeast: 5,
      desc: 'Tìm kiếm dịch giả/tác giả không dấu "cao viet dung" phải ra nhiều kết quả',
    },
    {
      query: '7507',
      expectedTitles: ['Bệnh tưởng'],
      desc: 'Tìm kiếm bằng 4 số cuối ISBN "7507" phải ra "Bệnh tưởng"',
    },
    {
      query: '7690',
      expectedCount: 2,
      desc: 'Tìm kiếm bằng 4 số cuối ISBN "7690" phải ra cả 2 bản Le Spleen de Paris (H21 & H36)',
    },
    {
      query: 'bt',
      expectedTitles: ['Bệnh tưởng'],
      desc: 'Tìm kiếm bằng mã tắt "bt" phải ra "Bệnh tưởng"',
    },
  ];

  let passed = 0;
  for (const tc of testCases) {
    const results = search(tc.query);
    const titles = results.map((r) => r.title);

    let ok = true;
    if (tc.expectedTitles) {
      for (const expected of tc.expectedTitles) {
        if (!titles.some((t) => t && t.includes(expected))) {
          ok = false;
        }
      }
    }
    if (tc.expectedCount !== undefined && results.length !== tc.expectedCount) {
      ok = false;
    }
    if (tc.expectedCountAtLeast !== undefined && results.length < tc.expectedCountAtLeast) {
      ok = false;
    }

    if (ok) {
      console.log(`✅ ĐẠT: [Query: "${tc.query}"] ➔ Tìm thấy ${results.length} kết quả:`);
      results.slice(0, 3).forEach((r) => console.log(`      - [${r.code}] ${r.title}`));
      passed++;
    } else {
      console.error(`❌ THẤT BẠI: [Query: "${tc.query}"] - ${tc.desc}`);
      console.error(`      Kết quả thực tế:`, titles);
      process.exit(1);
    }
  }

  console.log(`\n========================================================`);
  console.log(`🎉 TẤT CẢ ${passed}/${testCases.length} BÀI TEST TÌM KIẾM TIẾNG VIỆT ĐẠT 100%!`);
  console.log(`========================================================\n`);
}

runVietnameseSearchTests().catch((err) => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});