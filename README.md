# ApkStart Desktop (Bản Việt hóa & Tối ưu hóa)

Trình chạy ứng dụng Android độc lập, siêu nhẹ cho Windows dựa trên Google Android Emulator & Electron.

## Tính năng nổi bật & Đã tối ưu
- **Việt hóa 100%:** Toàn bộ giao diện người dùng, thông báo lỗi ADB, nhật ký khởi động máy ảo và tiến trình runtime.
- **Hỗ trợ cài đặt XAPK / APKS toàn diện:** Tự động giải nén và nạp đầy đủ các gói chia tách (Split APKs), `assetpack.apk` và thư viện native `arm64_v8a` thông qua `installMultiple`.
- **Tối ưu mạng & DNS:** Thay thế DNS Trung Quốc mặc định bằng Google DNS (`8.8.8.8, 1.1.1.1`) và máy chủ kiểm tra kết nối Google, giúp tải game và kết nối server tại Việt Nam ổn định, không bị timeout.
- **Tối ưu hiển thị đồ họa & GPU:**
  - Hỗ trợ card đồ họa rời NVIDIA / AMD với hardware acceleration (`-gpu host`).
  - Hỗ trợ chế độ cửa sổ độc lập (Detached Mode) giúp tránh hoàn toàn lỗi crash màn hình đen `0xC0000005`.
- **Tích hợp sẵn CH Play (Google Play Store)** với shortcut trực tiếp ngoài Desktop.

## Yêu cầu hệ thống
- **Hệ điều hành:** Windows 10 / 11 (64-bit)
- **Node.js:** >= 20
- **Công nghệ ảo hóa:** Bật WHPX (Windows Hypervisor Platform) hoặc AEHD

## Cài đặt & Phát triển
```bash
npm install
npm start
```
