# Workspace Agent Guidelines & Always-On Rules

## 0. PROJECT STATE — READ FIRST (mọi session/agent, trước mọi việc)

- Đọc ngay: `docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md` — **mục 10**
  (tổng kết + bài học) và mục 8.7 (việc còn treo). Đừng đọc số liệu cũ ở
  mục 1–9 của file đó: phần đó là bản ghi ngày 02/10, đã lỗi thời.
  - Tài liệu cũ hơn đã nằm ở `docs/archive/` — chỉ tra cứu lịch sử, KHÔNG
    phải nguồn ngữ cảnh. Xem `docs/archive/README.md` để biết vì sao bị bỏ.
  - **Số suite không ghi cứng ở đây.** Nguồn sự thật là `scripts/run-isolated.ts`.
- **`main` là nguồn sự thật.** Chủ đổi quy tắc 02/10/2026: **được commit lên
  `main`** để main luôn là code mới nhất. Luật cũ "không bao giờ commit lên
  `main`" **đã bị bỏ** — đừng làm ngược lại.
- Nhánh riêng chỉ dùng khi **làm song song với agent khác**. Làm một mình
  thì commit thẳng `main`.
- BẤT BIẾN, CẤM ĐỤNG: `[vars] NEXT_PRIVATE_MINIMAL_MODE="1"` trong `wrangler.toml`;
  twin backslash `@libsql\\client` trong `next.config.mjs`; KHÔNG commit
  secret/token (kể cả `scripts/deploy-cloudflare.ts`).
- Test: suite DB chung → `npx tsx scripts/run-isolated.ts --only=...`;
  không hạ assertion để xanh; không log PIN/giá trị secret.
- ⛔ **TEST KHÔNG ĐƯỢC DÙNG CHUNG HẰNG/GIÁ TRỊ VỚI CODE.** Đây là nguyên nhân
  gốc khiến bug lọt lên production 02/10: `paymentBreakdown.pendingQr` lọc
  `QR_TRANSFER` trong khi hệ thống thật dùng `BANK_TRANSFER` ⇒ tính năng luôn
  = 0 mà test vẫn xanh vì test dùng *cùng* giá trị sai.
  Giá trị hằng **phải lấy từ nguồn thật** (`src/db/schema.ts`, migration).
  Trước khi tin test xanh, **cắt 1 chỗ trong code và xem test có đỏ không.**
- **Giá trị hằng phải tra nguồn thật, KHÔNG ghi nhớ.** Vài giá trị dễ sai đã
  từng làm bug lọt production:
  | Cột | Giá trị thật | Nguồn |
  |---|---|---|
  | `orders.payment_method` | `CASH` \| `BANK_TRANSFER` \| `QR_CODE` (chấp nhận thêm `TRANSFER` cũ) | `src/db/schema.ts` dòng `paymentMethod` |
  | `orders.status` | đọc trực tiếp từ `schema.ts`, không suy từ nhãn UI | `src/db/schema.ts` |
  | Sự kiện `inventory_ledger` | `RECEIPT` \| `DISPATCH_SALE` \| `DISPATCH_GIFT` \| `ADJUSTMENT` \| `RETURN_INBOUND` | `src/db/migrations/*.sql` |
  **KHÔNG có** `QR_TRANSFER`, `COUNTER_TRANSFER`, `RECEIVE`, `SALE_FULFILL`,
  `STOCKTAKE_ADJUST`. Gặp tên lạ trong code cũ/docs ⇒ tra schema, đừng đoán.
- ⛔ **`tsc` KHÔNG validate CSS.** Thêm vào checklist trước khi push: nếu
  sửa file `.css` thì **phải chạy `npm run build`** — `tsc` sạch không có
  nghĩa là build được. Lỗi `}` thừa đã làm cả repo không build.
- TÊN TRONG UI: ngắn, dọn, **tiếng Việt CÓ DẤU**. Ví dụ đúng: "Mở Kho",
  "Xoá Kho", "Ngưng hoạt động", "Ma trận", "Cần xác nhận", "Không tìm thấy",
  "Kiểm tra tồn kho". Cấm nhãn dài kiểu "Quản lý kho hàng hội chợ / gian hàng
  sự kiện", và cấm tiếng Việt KHÔNG DẤU (viết "Dán", "Kiểm tra", "Khớp tuyệt
  đối", không viết "Dan", "Kiem tra", "Khop tuyet doi"). Tên nút là động từ ngắn.
- Mỗi hành động phải có DẤU HIỆU BẤM RÕ: icon, viền, nhãn aria nói rõ thao tác,
  và trạng thái sau khi bấm (ví dụ "Đã thêm: <tên>"). Không để nút trông như
  mảng chữ — người dùng sẽ không dám bấm.
- **TÊN CÔNG TY TRONG MỌI MẪU IN: `FORMApubli`** (chủ doanh nghiệp chốt 01/10/2026).
  Dùng cho biên bản chốt ngày, phiếu xuất kho, hoá đơn bán hàng, và MỌI tài liệu in
  sau này. KHÔNG viết "CÔNG TY TNHH XUẤT BẢN FORMA" nữa — chủ doanh nghiệp đã đổi
  tên hiển thị. Nếu cần tên pháp lý đầy đủ thì hỏi lại chủ doanh nghiệp, không tự
  suy diễn.

This repository is configured with two always-on frameworks:
1. **Ponytail** (Lazy senior dev mode — YAGNI, standard library first, shortest diffs, root-cause bug fixing)
2. **Superpowers** (Core engineering skills library & mandatory skill-first discipline)

---

## 0. Dev Server = LAN, Always

- ⚠️ **MUỐN TEST CAMERA / MÁY QUÉT MÃ THÌ PHẢI DÙNG `npm run dev:https`,
  KHÔNG PHẢI `dev:lan`.** Đây là điều tôi đã bỏ sót và người dùng phải nhắc:
  trình duyệt **chỉ cấp `getUserMedia` ở secure context**, tức `https://` hoặc
  `http://localhost`. Mở dev bằng IP LAN (`http://192.168.x.x`) thì **camera không
  bật được** ⇒ test scanner trên điện thoại là vô nghĩa.
  · `npm run dev:https` = Next dev + `--experimental-https` với cert tự ký trong
    `certificates/`.
  · Trình duyệt **sẽ báo chứng thư không đáng tin** → bấm **Nâng cao → Vẫn truy cập**,
    nếu không camera vẫn không được.
  · **IP đổi theo DHCP** ⇒ cert cũ không khớp. Chạy `npm run cert:make` để sinh lại
    (tự đọc IP LAN hiện tại, tự tìm `openssl`, tự thêm IP vào SAN).
  · `certificates/` đã gitignore — chứa private key, **tuyệt đối không commit**.

The user tests on a real phone. A localhost-only dev server is useless to them.

- Always start the dev server with `npm run dev:lan` (`next dev -H 0.0.0.0`), never bare `npm run dev`.
- Always report the LAN URL, not just `localhost`. LAN IP on this machine: `192.168.1.8` (Wi-Fi; đổi từ `192.168.1.22` ngày 03/10/2026 theo DHCP). MÁY CÓ THỂ ĐỔI IP — chạy `Get-NetIPAddress -AddressFamily IPv4` để lấy IP hiện tại, đừng dùng IP cũ trong tài liệu. Cẩn thậng: `172.20.x.x` là adapter ảo (Hyper-V/WSL), KHÔNG phải IP điện thoại dùng được — phải lấy IP của adapter Wi-Fi/Ethernet có `Status = Up`.
- Give the user both: `http://localhost:3000` for the desktop, `http://192.168.1.8:3000` for the phone.
- Never assume a UI fix is verified until it is measured in a real browser (`orca eval` / `orca screenshot`).
  A green source-level test suite has already shipped an invisible dropdown once; the assertion was green and
  the menu was 6597px below the viewport.
- **Service worker che code mới.** App này có PWA: sau khi đã từng mở `localhost:3000` một lần,
  SW giữ cache và tải JS cũ. Triệu chứng: bạn sửa file, `curl` thấy mã mới, TypeScript sạch, test xanh,
  nhưng trình duyệt vẫn chạy hành vi cũ và `next dev` **không** recompile. Đã mất nhiều lượt debug
  sai vì tưởng bug của code trong khi thực ra là cache. Trước khi kết luận "code tôi sửa không chạy":
  1. `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` — xác nhận đúng 1 tiến trình `next dev`
     và nó mới khởi động (Start-Process không giết được tiến trình cũ giữ port 3000).
  2. Kiểm tra bundle thật: `curl` trang rồi grep từ khóa mới trong `/_next/static/chunks/*.js`.
  3. Xoá SW + cache rồi tải lại:
     `await (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister())` và
     `await caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))`.
- **`npm install` KHÔNG cài devDependencies.** Lệnh thường báo "added N packages"
  nhưng `typescript` và `@opennextjs/cloudflare` vẫn vắng mặt ⇒ `npx tsc` resolve
  nhầm package `tsc` khác, và `next dev` chết vì không đọc được `next.config.mjs`.
  Đã mất nhiều lượt debug vì tưởng repo hỏng. Phải dùng:
  `npm install --include=dev`
  Sau đó kiểm `Test-Path node_modules\typescript\package.json` phải True.
- **CÓ THỂ CHẠY SONG SONG 2 AGENT TRÊN CÙNG MÁY. Đã xảy ra sự cố thật.**
  Agent khác sửa `src/components/pos/TransferPaymentModal.tsx` lúc tôi đang làm
  việc, và `npm run deploy` của tôi **đã nuốt code chưa commit của họ lên
  production** (`dbf1dd94`). Không phải do `git commit` — mà do `build`/`deploy`
  đọc **working tree**, không đọc git.
  ⚠️ **`git worktree remove` ĐI THEO JUNCTION — ĐÃ MẤT `node_modules` THẬT.**
    Worktree agent tạo bằng `New-Item -ItemType Junction` trỏ tới
    `formapubli-orch/node_modules` để khỏi cài lại. Khi `git worktree remove
    --force` xoá worktree, nó xoá **cả nội dung thật sau junction**, không chỉ
    link ⇒ mất sạch `node_modules` của trụ chính. Đã dính một lần lúc dọn 12
    worktree, phải `npm install --include=dev` lại từ đầu (mất nhiều phút).
    **Cách đúng: copy thật, hoặc cài riêng từng worktree.** Nếu buộc dùng
    junction để tiết kiệm, phải `cmd /c rmdir <link>` (rdmdir trên junction chỉ
    gỡ link) **trước**, rồi mới `git worktree remove`.
  Quy tắc bắt buộc (từ 2026-09-29, **đã sửa 03/10/2026**):
  - ⛔ **KHÔNG có worktree `formapubli-orch` nữa — nó đã bị xoá.** Cũng đã xoá
    `formapubli-promo`, `-sales`, `-dashboard`. **Hiện chỉ còn MỘT cây:
    `D:\Data Project\formapubli` trên `main`** (kiểm bằng `git worktree list`).
    Luật cũ "Coordinator làm ở worktree riêng, không bao giờ sửa trong
    `formapubli`" **không còn đúng** — làm một mình thì sửa thẳng ở đây.
  - Worktree riêng chỉ tạo khi **thật sự làm song song với agent khác**, và
    phải có `node_modules` thật (copy hoặc `npm install --include=dev` riêng).
  - **Chỉ deploy khi working tree nguồn của lệnh deploy SẠCH.** Chạy
    `git status --porcelain` ngay trước `npm run deploy`; nếu có dòng lạ thuộc
    việc người khác thì **dừng**, không deploy.
  - `git add` luôn ghi rõ từng file, **không** `-A`, **không** `commit -a`.
  - Không dừng/kill `next dev` của agent khác. `.next` là thư mục riêng theo
    worktree nên build của mình không đụng của họ — đã kiểm chứng.
  - Muốn bảo hiểm code chưa commit của agent khác: lưu `git diff -- <file>` ra
    ngoài repo, **không** commit hộ, **không** stash (stash sẽ gỡ file khỏi
    working tree của họ và làm hỏng công việc đang dở).
- ⛔ **`background_process` BỎ QUA tham số `workdir` trên máy này.** Đã dính 2
  lần: `npm run dev:lan` truyền `workdir` vẫn khởi động ở `D:\Data Project\
  formapubli` và ghi vào `.next` của worktree chính ⇒ **phục vụ nhầm code**.
  Cách đúng: `Set-Location -LiteralPath '<worktree>'` **trong chính lệnh**.
  Dấu hiệu phát hiện: so `LastWriteTime` của `.next` ở các cây.
- ⚠️ **Shell tool: luôn truyền `workdir`.** Đã dính **2 lần**
  trong một ngày: gọi `Test-Path 'node_modules\...'` mà không kèm `workdir` ⇒
  PowerShell chạy ở thư mục gốc của session (`D:\Data Project\formapubli`, vốn
  chưa bao giỜ có `node_modules`) ⇒ báo "KHÔNG" ⇒ tưởng `node_modules` bị mất
  trong khi nó vẫn nguyên. Một lần khác là shell trả về **không có output gì cả**,
  dễ bị hiểu là treo. Kiểm tra đường dẫn nào đó thì dùng **đường dẫn tuyệt đối**
  để không phụ thuộc CWD.
- **Deploy là việc của coordinator, không tự ý chạy.** Chỉ deploy khi cây nguồn
  sạch, tsc sạch, build sạch, và test liên quan xanh — rồi báo version ID.
- ⚠️ **KHÔNG BAO GIỜ xoá remote branch bằng danh sách tính tự động.**
  Đã dính: `git branch -r --merged main` trả về cả `origin/main` và lệnh
  `git push origin --delete main` chạy thật. May là GitHub chặn nhánh mặc định,
  nhưng lỗi lại bị `2>&1 | Out-Null` nuốt nên tưởng đã xoá xong — nếu remote
  cho phép, đây là mất nhánh chính.
  Quy tắc: (1) **luôn loại `main`/`master` khỏi danh sách**, kể cả khi chúng xuất
  hiện; (2) **không nuốt lỗi** khi xoá — phải thấy kết quả từng lệnh; (3) sau khi
  xoá, kiểm lại bằng `git ls-remote --heads origin` (**đây mới là sự thật**, cache
  cục bộ có thể đã cũ).
4. **Quy tắc 1–4:** nghiệm thu chưa xong cho tới khi có bằng chứng ở đúng tầng mà
   lỗi sống. Lỗi sống ở `src/` thì `npx tsc --noEmit` là bằng chứng tầng 1; lỗi
   chạy lúc deploy thì `npm run build` là tầng 2; lỗi hiện ra ngoài qua HTTP thì
   **phải gọi HTTP thật** — tầng 3 là `npx tsx scripts/verify-pos-live.ts` (đăng
   nhập thật, gọi API thật, tạo 1 đơn thật, kiểm mã 13 ký tự + tồn + báo cáo).
   Nó bắt được một lỗi mà 100 suite không bắt: dev DB thiếu migration ⇒ **mọi
   đơn trả 500**. Chạy script này sau mỗi đợt sửa POS/kho/báo cáo.
5. **`formapubli.db` (DB dev cục bộ) có thể TỤT HẬU so với production.** Nó không
   tự migrate. Kiểm bằng `npx tsx scripts/check-dev-db-schema.ts`; vá bằng
   `npx tsx scripts/fix-dev-db-schema.ts` (tự sao lưu `.bak`, tự kiểm tra trước
   khi chạy). Thiếu bảng ⇒ **tạo đơn trả 500**, và thiếu trigger ⇒ **tồn âm lọt
   qua trong lúc bạn đang sửa**.
6. **Lấy cấu trúc DDL TỪ FILE MIGRATION, không tự viết.** Tôi tự viết `CREATE
   TABLE daily_order_counters (business_date …)` trong khi code tìm cột `day` ⇒
   vẫn 500 sau khi "đã vá". Phải mở `src/db/migrations/00XX_*.sql` và copy
   nguyên văn.
- **File watcher của `next dev` trên máy này hay bị trễ/hỏng khi có nhiều worktree. Nếu sửa file mà
  log không in `Compiled`, **restart dev server** thay vì chờ.
- NEVER run `next build` while `next dev` is running: the build overwrites `.next/`, the dev server keeps
  serving the old asset manifest, every CSS/JS 404s and the user gets a completely unstyled page.
  Sequence is always: stop dev -> build -> delete `.next` -> `npm run dev:lan`.

---

## 1. Ponytail: Lazy Senior Dev Mode (Always-On)

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

### The Ladder
Before writing any code, stop at the first rung that holds:
1. **Does this need to be built at all? (YAGNI)** Speculative need = skip it.
2. **Does it already exist in this codebase?** Reuse the helper, util, type, or pattern already here. Don't rewrite it.
3. **Does the standard library already do this?** Use it.
4. **Does a native platform feature cover it?** Use it.
5. **Does an already-installed dependency solve it?** Use it. Never add a new dependency for what a few lines can do.
6. **Can this be one line?** Make it one line.
7. **Only then:** write the minimum code that works.

The ladder runs *after* you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

### Bug Fix = Root Cause, Not Symptom
A report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves sibling callers still broken.

### Rules
- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size: lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

### When NOT to be Lazy
- Never lazy about understanding the problem (read fully and trace the real flow before picking a rung).
- **Input validation at trust boundaries**.
- **Error handling that prevents data loss**.
- **Security & accessibility**.
- **The calibration real hardware needs**.
- Anything explicitly requested.
- Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

---

## 2. Superpowers: Skill Invocation Engine (Always-On)

### The Mandatory Rule
**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

- **Before entering plan mode:** if you haven't already brainstormed, invoke the `brainstorming` skill first.
- **Before fixing a bug:** invoke `systematic-debugging` first.
- **Before implementing non-trivial features:** invoke `writing-plans` -> `subagent-driven-development` or `executing-plans` -> `test-driven-development` -> `verification-before-completion`.

### Red Flags — Stop Rationalizing
| Rationalization | Reality |
|---|---|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

### Antigravity Tool Mapping
- **Subagents**: Use `invoke_subagent` with built-in `TypeName`: `self` for full-capability work, `research` for read-only codebase exploration.
- **Task Tracking**: Antigravity has no interactive todo list tool (`manage_task` manages OS background processes). Track tasks using a task artifact (`write_to_file` with `IsArtifact: true` and `ArtifactType: "task"`), updating items with `replace_file_content` as progress is made.

---

## 3. Installed Workspace Skills

The following skills are installed in `.agents/skills/` and `skills/`:

1. `brainstorming`: Explore requirements and design before jumping into implementation or planning.
2. `diagnosing-superpowers`: Self-diagnosis and troubleshooting for skills & plugins.
3. `dispatching-parallel-agents`: Concurrently execute independent subagent tasks.
4. `executing-plans`: Execute an approved engineering implementation plan step-by-step.
5. `finishing-a-development-branch`: Wrap up a branch, verify test suite, and prepare PR.
6. `ponytail`: Intensity-based lazy dev mode (lite, full, ultra) enforcing minimal code.
7. `receiving-code-review`: Handle incoming review feedback methodically.
8. `requesting-code-review`: Review changes against requirements and standards before merging.
9. `subagent-driven-development`: Dispatch subagents per task to keep context clean and verify work.
10. `systematic-debugging`: Multi-phase disciplined root cause investigation before proposing fixes.
11. `test-driven-development`: Red-green-refactor cycle, minimal test first, then implementation.
12. `using-git-worktrees`: Manage isolated git worktree environments.
13. `using-superpowers`: Core bootstrap establishing how skills are located and triggered.
14. `verification-before-completion`: Rigorous verification (build, tests, edge cases) before completion.
15. `writing-plans`: Write structured, actionable multi-step implementation plans.
16. `writing-skills`: Design and package reusable agent skills.

