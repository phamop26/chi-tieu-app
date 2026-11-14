# Chi Tiêu

Web app (PWA) giúp theo dõi chi tiêu cá nhân bằng cách tự phân loại giao dịch từ sao kê ngân hàng (CSV, Excel, PDF).

- Mọi dữ liệu được xử lý và lưu **trên chính thiết bị** (IndexedDB). Không có máy chủ, không dùng AI bên ngoài.
- Số tài khoản / số thẻ được che ngay khi đọc file.
- Khóa bằng mã PIN hoặc sinh trắc học; xóa toàn bộ dữ liệu bất kỳ lúc nào.
- Tiếng Việt, English, Français.

Kho này chỉ chứa mã nguồn của app — không chứa dữ liệu của người dùng.

Chạy thử trên máy: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8777` rồi mở http://localhost:8777
