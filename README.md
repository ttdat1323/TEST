# Hana Exam Lab

Website luyện đề chạy hoàn toàn bằng HTML, CSS và JavaScript, có thể đưa thẳng lên GitHub Pages mà không cần cài đặt hay build.

## Chức năng đã có

- Trang chủ với hai khu vực chính: **Đề Toán** và **Đề Vật lý**.
- Kho đề Toán có trạng thái khóa/mở theo thời gian công khai.
- Trình tạo đề Toán bằng cách dán, kéo-thả hoặc chọn ảnh.
- Cấu trúc cố định:
  - Phần I: 12 câu trắc nghiệm A–D.
  - Phần II: 4 câu đúng–sai, mỗi câu 4 ý a–d.
  - Phần III: 6 câu trả lời ngắn, mỗi đáp án tối đa 4 ký tự.
- Người làm phải nhập tên, được chọn thời lượng và chỉ bắt đầu đếm giờ sau khi bấm **Bắt đầu**.
- Bài làm được tự lưu trên trình duyệt; tải lại trang vẫn tiếp tục với hạn giờ cũ.
- Nộp bằng nút **Nộp bài** hoặc tự nộp khi hết giờ.
- Chấm tự động trên thang 10 và xem lại kết quả từng phần.
- Bốn giao diện màu, responsive cho máy tính và điện thoại.

## Cấu trúc file

| File | Vai trò |
|---|---|
| index.html | Trang chủ |
| math.html | Danh sách đề Toán |
| exam.html | Trang làm bài |
| physics.html | Trang Đề Vật lý — hiện để trạng thái sắp cập nhật |
| create-math.html | Trình tạo đề Toán |
| math-exams.js | Dữ liệu của toàn bộ đề Toán |
| exam.js | Hiển thị đề, đếm giờ, lưu bài và chấm điểm |
| builder.js | Dán/nén ảnh, tự lưu nháp và xuất dữ liệu đề |
| app.js | Theme, menu mobile, đồng hồ và phần dùng chung |
| styles.css | Toàn bộ giao diện |
| profile.jpg | Ảnh đại diện/logo |
| projects.html, blog.html | Chuyển hướng từ đường dẫn cũ sang trang mới |

## Đưa website lên GitHub Pages

1. Tạo repository GitHub mới hoặc mở repository hiện tại.
2. Tải **toàn bộ file trong thư mục này** lên thư mục gốc của nhánh main.
3. Vào **Settings → Pages**.
4. Trong **Build and deployment**, chọn **Deploy from a branch**.
5. Chọn nhánh main, thư mục / (root), rồi bấm **Save**.
6. Chờ GitHub cung cấp đường dẫn dạng https://ten-tai-khoan.github.io/ten-repository/.

Các liên kết trong dự án đều là đường dẫn tương đối nên vẫn hoạt động khi GitHub Pages nằm trong một repository con.

## Tạo và đăng một đề Toán mới

1. Mở create-math.html trên website.
2. Nhập tiêu đề, mã đề, mô tả, thời điểm mở đề, múi giờ và thời lượng chuẩn.
3. Hoàn thiện đủ 22 câu:
   - Đưa con trỏ bàn phím tới vùng ảnh rồi nhấn Ctrl+V/Cmd+V; hoặc kéo ảnh vào; hoặc bấm vùng ảnh để chọn file.
   - Chọn đáp án đúng cho từng câu/ý.
   - Với phần trả lời ngắn, có thể cho nhiều đáp án tương đương bằng dấu |, ví dụ 1,5|1.5. Mỗi biến thể phải dài không quá 4 ký tự.
4. Bấm **Lưu vào kho đề**.
5. Bấm **Tải math-exams.js**.
6. Trong repository GitHub, thay file math-exams.js cũ bằng file vừa tải rồi commit.
7. Chờ GitHub Pages cập nhật. Đề sẽ tự mở trên giao diện khi đến thời gian đã đặt.

Trình tạo đề tự lưu bản nháp trong trình duyệt. Tuy vậy, nên xuất file sau mỗi lần hoàn thiện để có bản sao dự phòng.

## Quy tắc chấm điểm môn Toán

- Phần I: mỗi câu đúng 0,25 điểm; tối đa 3,00.
- Phần II: xét riêng từng câu:
  - đúng 0 ý: 0;
  - đúng 1 ý: 0,10;
  - đúng 2 ý: 0,25;
  - đúng 3 ý: 0,50;
  - đúng 4 ý: 1,00.

  Bốn câu tối đa 4,00 điểm.
- Phần III: mỗi câu đúng 0,50 điểm; tối đa 3,00.
- Tổng tối đa: 10,00.

Khi đối chiếu câu trả lời ngắn, website bỏ khoảng trắng, coi dấu phẩy và dấu chấm thập phân tương đương, chuẩn hóa dấu trừ và không phân biệt chữ hoa/chữ thường.

## Hai giới hạn quan trọng của GitHub Pages

### 1. Hẹn giờ chỉ khóa ở giao diện

GitHub Pages là hosting tĩnh. File math-exams.js đã nằm trong repository công khai trước giờ mở, nên người am hiểu kỹ thuật vẫn có thể đọc mã nguồn hoặc thay đổi đồng hồ máy. Cơ chế hiện tại phù hợp với luyện tập và phát đề thông thường, nhưng **không phải cơ chế bảo mật đề thi**.

Nếu cần giữ bí mật tuyệt đối đến giờ mở, cần một trong hai hướng:

- tự động triển khai file đúng giờ bằng GitHub Actions và không lưu đề sớm trên nhánh công khai; hoặc
- dùng backend/database chỉ trả nội dung sau thời điểm mở.

### 2. Kết quả không được gửi về cho giáo viên

Tên, câu trả lời và điểm chỉ lưu trên thiết bị của người làm. Website không có máy chủ nên không thể tạo danh sách thí sinh hoặc bảng điểm tập trung. Muốn thu bài, có thể bổ sung Firebase, Supabase, Google Apps Script/Sheets hoặc một backend riêng trong phiên bản sau.

## Lưu ý về ảnh

- Chấp nhận PNG, JPEG và WebP.
- Ảnh được giảm kích thước và chuyển sang WebP trước khi nhúng vào file đề.
- Không nên dùng ảnh quá dài hoặc quá mờ.
- Nhiều ảnh lớn sẽ làm math-exams.js nặng; nên cắt sát phần câu hỏi trước khi dán.

## Kiểm tra nhanh sau khi cập nhật

- Mở math.html và kiểm tra thẻ đề.
- Mở đề trước giờ để kiểm tra trạng thái khóa.
- Đặt một đề thử với thời gian quá khứ để kiểm tra toàn bộ luồng.
- Thử nhập tên, chọn thời lượng, tải lại khi đang làm và nộp bài.
- Kiểm tra một bài đúng toàn bộ phải được 10,00 điểm.
- Kiểm tra giao diện trên điện thoại trước khi gửi link cho học sinh.
