# Random YouTube Chapters

Tiện ích Chrome MV3 thêm nút bật/tắt phát ngẫu nhiên cạnh nút View chapters trong trình phát YouTube. Bật tính năng cho video hiện tại bằng nút Random trong menu tiện ích hoặc nút bên cạnh chapter. Trạng thái bật/tắt được lưu riêng theo video và mặc định tắt.

## Cài đặt

1. Mở `chrome://extensions` trong Chrome.
2. Bật **Developer mode**.
3. Chọn **Load unpacked** và chọn thư mục dự án này.
4. Tải lại trang xem YouTube đang mở.

## Cách hoạt động và giới hạn

- Hỗ trợ trang video thông thường dạng `youtube.com/watch?v=...`.
- Đọc chapter marker có sẵn trong dữ liệu trình phát của YouTube; dùng DOM của danh sách chương làm phương án dự phòng. Tiện ích không gửi yêu cầu mạng và không tự mở bảng chương.
- Mỗi lần phát video, tiện ích ghi nhớ các chapter đã bắt đầu phát trong phiên trang hiện tại. Lịch sử giữ nguyên khi chuyển video bằng điều hướng bên trong YouTube, nhưng bắt đầu lại sau khi tải lại trang.
- Mặc định, chapter đã phát sẽ được bỏ qua cho đến khi mọi chapter khác đã phát; sau đó tiện ích tự bắt đầu lượt mới. Có thể bật **Cho phép phát lại chapter đã phát** trong menu tiện ích để cho phép lặp sớm. Đây là tùy chọn chung cho tiện ích và được lưu lại. Chapter vừa kết thúc luôn bị loại khỏi lựa chọn kế tiếp.
- Khi người dùng tự tua, tiện ích không kích hoạt nhảy ngẫu nhiên. Chapter được tính là đã phát khi video thực sự bắt đầu hoặc tiếp tục phát tại chapter đó.
- Video có ít hơn hai chapter được phát hiện sẽ không tự nhảy.
- YouTube có thể thay đổi cấu trúc dữ liệu trình phát; nếu trang không cung cấp dữ liệu chapter, tiện ích có thể không phát hiện được chapter.

## Kiểm tra utility

Chạy `node --test tests/chapter-utils.test.cjs` bằng Node.js.

## Cập nhật tiện ích

Sau khi cập nhật các tệp tiện ích, mở `chrome://extensions` và nhấn **Reload** tại tiện ích này. Sau đó tải lại trang xem YouTube.
