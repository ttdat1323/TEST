# Hana Exam Lab

Website tạo và luyện đề chạy hoàn toàn bằng HTML, CSS và JavaScript, có thể đưa thẳng lên GitHub Pages mà không cần cài đặt hay build.

## Chức năng

- Hai kho đề riêng: **Đề Toán** và **Đề Vật lý**, có trạng thái khóa/mở theo thời gian công khai.
- Menu chỉ có một mục **Tạo đề**; sau khi bấm, người ra đề chọn **Tạo đề Toán** hoặc **Tạo đề Lý**.
- Cấu trúc đề Toán: 12 câu trắc nghiệm A–D, 4 câu đúng–sai (mỗi câu 4 ý) và 6 câu trả lời ngắn.
- Cấu trúc đề Vật lý: 18 câu trắc nghiệm A–D, 4 câu đúng–sai (mỗi câu 4 ý) và 6 câu trả lời ngắn.
- Mỗi câu nhận số ảnh tùy ý bằng thao tác dán, kéo-thả hoặc chọn nhiều tệp; từng ảnh được nén trước khi lưu.
- Người làm phải nhập tên, chọn thời lượng, có đồng hồ đếm ngược, tự lưu bài và tự nộp khi hết giờ.
- Chấm tự động trên thang 10, xem điểm từng phần và đáp án sau khi nộp.
- Bốn giao diện màu, responsive cho máy tính và điện thoại.

Bộ dữ liệu ban đầu không chứa đề minh họa. Khi chưa đăng đề, trang môn học hiển thị trạng thái kho trống.

## Cấu trúc file

| File | Vai trò |
|---|---|
| `index.html` | Trang chủ |
| `math.html`, `physics.html` | Danh sách đề Toán và Vật lý |
| `create.html` | Trang chọn môn để tạo đề |
| `create-math.html`, `create-physics.html` | Trình tạo đề Toán và Vật lý |
| `math-exams.js`, `physics-exams.js` | Dữ liệu đề của từng môn |
| `exam.html` | Phòng làm bài dùng chung |
| `exam.js` | Hiển thị đề, đếm giờ, lưu bài và chấm điểm theo môn |
| `builder.js` | Trình tạo dùng chung: nhiều ảnh, tự lưu nháp, nhập/xuất dữ liệu |
| `app.js` | Giao diện màu, menu mobile, đồng hồ và phần dùng chung |
| `styles.css` | Toàn bộ giao diện |
| `profile.jpg` | Ảnh đại diện/logo |
| `projects.html`, `blog.html` | Chuyển hướng từ đường dẫn cũ |

## Đưa website lên GitHub Pages

1. Tạo repository GitHub mới hoặc mở repository hiện tại.
2. Tải **toàn bộ file trong thư mục này** lên thư mục gốc của nhánh `main`.
3. Vào **Settings → Pages**.
4. Trong **Build and deployment**, chọn **Deploy from a branch**.
5. Chọn nhánh `main`, thư mục `/ (root)`, rồi bấm **Save**.
6. Chờ GitHub cung cấp đường dẫn dạng `https://ten-tai-khoan.github.io/ten-repository/`.

Các liên kết đều là đường dẫn tương đối nên vẫn hoạt động khi GitHub Pages nằm trong một repository con.

## Tạo và đăng đề mới

1. Bấm **Tạo đề**, rồi chọn Toán hoặc Lý.
2. Nhập tiêu đề, mã đề, mô tả, thời điểm mở, múi giờ và thời lượng chuẩn.
3. Hoàn thiện đủ câu theo môn:
   - Toán: 12 + 4 + 6 = 22 câu.
   - Vật lý: 18 + 4 + 6 = 28 câu.
4. Tại mỗi câu, dán ảnh bằng `Ctrl+V`/`Cmd+V`, kéo-thả ảnh, hoặc chọn một hay nhiều tệp. Thứ tự ảnh trong danh sách là thứ tự hiển thị cho người làm.
5. Chọn đáp án đúng cho từng câu/ý. Với trả lời ngắn, dùng dấu `|` cho các đáp án tương đương, ví dụ `1,5|1.5`; mỗi biến thể tối đa 4 ký tự.
6. Bấm **Lưu vào kho đề**, sau đó tải đúng file dữ liệu:
   - Toán: `math-exams.js`.
   - Vật lý: `physics-exams.js`.
7. Thay đúng file cùng tên trong repository rồi commit. Đề sẽ tự mở trên giao diện khi đến thời gian đã đặt.

Trình tạo tự lưu bản nháp và kho đề riêng cho từng môn trên thiết bị. Vẫn nên xuất file sau mỗi lần hoàn thiện để có bản sao dự phòng.

## Quy tắc chấm điểm

### Môn Toán

- Phần I: 12 × 0,25 = 3,00 điểm.
- Phần II: tối đa 4,00 điểm.
- Phần III: 6 × 0,50 = 3,00 điểm.
- Tổng: 10,00 điểm.

### Môn Vật lý

- Phần I: 18 × 0,25 = 4,50 điểm.
- Phần II: tối đa 4,00 điểm.
- Phần III: 6 × 0,25 = 1,50 điểm.
- Tổng: 10,00 điểm.

Ở Phần II, từng câu được chấm theo số ý đúng: 0 ý = 0; 1 ý = 0,10; 2 ý = 0,25; 3 ý = 0,50; 4 ý = 1,00 điểm.

Khi đối chiếu trả lời ngắn, website bỏ khoảng trắng, coi dấu phẩy và dấu chấm thập phân tương đương, chuẩn hóa dấu trừ và không phân biệt chữ hoa/chữ thường.

## Hai giới hạn quan trọng của GitHub Pages

### 1. Hẹn giờ chỉ khóa ở giao diện

GitHub Pages là hosting tĩnh. `math-exams.js` và `physics-exams.js` nằm trong repository công khai, nên người am hiểu kỹ thuật vẫn có thể đọc mã nguồn, đáp án hoặc thay đổi đồng hồ máy trước giờ mở. Cơ chế này phù hợp để luyện tập và phát đề thông thường, nhưng **không phải cơ chế bảo mật đề thi**.

Muốn giữ bí mật tuyệt đối, cần triển khai file đúng giờ bằng GitHub Actions hoặc dùng backend/database chỉ trả nội dung sau thời điểm mở.

### 2. Kết quả không được gửi về cho giáo viên

Tên, câu trả lời và điểm chỉ lưu trên thiết bị của người làm. Website tĩnh không thể tạo danh sách thí sinh hay bảng điểm tập trung. Muốn thu bài, cần bổ sung Firebase, Supabase, Google Apps Script/Sheets hoặc một backend riêng.

## Lưu ý về ảnh

- Chấp nhận PNG, JPEG và WebP; có thể chọn nhiều ảnh trong một lần.
- Không đặt giới hạn số ảnh mỗi câu. Từng ảnh được giảm kích thước và chuyển sang WebP trước khi nhúng vào file đề.
- Khung ảnh có kích thước hiển thị cố định và dùng `object-fit: contain`, nên giữ trọn nội dung, đúng tỉ lệ và không bị kéo méo; người làm có thể bấm để phóng to.
- Nhiều ảnh lớn sẽ làm file `*-exams.js` nặng. Nên cắt sát nội dung, dùng ảnh rõ nét và kiểm tra dung lượng trước khi commit.

## Kiểm tra nhanh sau khi cập nhật

- Mở `math.html` và `physics.html`; kho trống phải hiển thị đúng, không còn đề minh họa mặc định.
- Kiểm tra menu chỉ có một mục **Tạo đề**, rồi thử chọn cả Toán và Lý.
- Xác nhận trình tạo hiển thị đúng 12 câu trắc nghiệm cho Toán và 18 câu cho Vật lý.
- Thử thêm, xóa, đổi thứ tự nhiều ảnh trong một câu; kiểm tra khung ảnh và chức năng phóng to trên máy tính lẫn điện thoại.
- Kiểm tra nhập/xuất riêng `math-exams.js` và `physics-exams.js`, không trộn hai kho đề.
- Mở đề trước giờ để kiểm tra trạng thái khóa; đặt một đề thử ở thời gian quá khứ để kiểm tra toàn bộ luồng.
- Thử nhập tên, chọn thời lượng, tải lại khi đang làm và nộp bài; bài đúng toàn bộ ở cả hai môn phải đạt 10,00 điểm.

