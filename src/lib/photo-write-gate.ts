/**
 * CỔNG GHI ẢNH XÁC NHẬN — giữ đúng thứ tự giữa các lần ghi.
 *
 * VÌ SAO CẦN: lưu ảnh xác nhận chuyển khoản có thể KẸT (IndexedDB bị dồn bộ
 * nhớ trên iOS, ITP). Modal hết giờ chờ thì mở khoá cho cashier chụp lại, nhưng
 * lần ghi cũ vẫn chạy nền. Gọi thẳng cha hai lần ⇒ không có thứ tự, lần xong
 * sau thắng, ảnh cũ đè ảnh mới, rồi cha gửi `paymentProof.id` cũ lên server cho
 * một đơn đã thu tiền. Chỉ bật/tắt cờ bằng `isSaving` không chặn được: nó nói
 * "đang lưu" chứ không nói lần nào được quyền ghi.
 *
 * Cổng này chặn đúng điều đó:
 *   - `begin()` mở lần ghi mới ⇒ mọi lần ghi cũ hơn mất hiệu lực (thế hệ).
 *   - `run()` chạy lần ghi THEO HÀNG ĐỢI: lần sau chỉ gọi task sau khi lần
 *     trước kết thúc, và lần đã bị thay thế thì không gọi task — nên không bao
 *     giờ ghi đè lần mới hơn.
 */
export interface PhotoWriteGate {
  /** Mở một lần ghi mới, trả về số thế hệ của lần đó. */
  begin(): number;
  /** Lần ghi `gen` còn hiện hành (chưa bị lần ghi mới hơn thay thế) không? */
  isCurrent(gen: number): boolean;
  /**
   * Chạy task ghi của lần `gen`: xếp hàng sau các lần trước rồi mới gọi task;
   * nếu lần `gen` đã bị thay thế thì bỏ qua (trả `undefined`, không ghi gì cả).
   */
  run<T>(gen: number, task: () => Promise<T>): Promise<T | undefined>;
}

export function createPhotoWriteGate(): PhotoWriteGate {
  let generation = 0;
  /** Đuôi hàng đợi: luôn resolve (lần trước hỏng không chặn lần sau). */
  let tail: Promise<unknown> = Promise.resolve();

  return {
    begin() {
      generation += 1;
      return generation;
    },

    isCurrent(gen: number) {
      return gen === generation;
    },

    async run<T>(gen: number, task: () => Promise<T>): Promise<T | undefined> {
      const previous = tail;
      const result = (async () => {
        try {
          await previous;
        } catch {
          /* hàng đợi không bao giờ reject, đây chỉ là lưới an toàn */
        }
        if (gen !== generation) return undefined;
        return task();
      })();
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
}
