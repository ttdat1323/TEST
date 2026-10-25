# Hana Exam Lab

Website tạo và luyện đề chạy hoàn toàn bằng HTML, CSS và JavaScript, có thể đưa thẳng lên GitHub Pages mà không cần cài đặt hay build.

## Chức năng

- Ba kho riêng: **Đề Toán**, **Đề Vật lý** và **Bài kiểm tra**, có trạng thái khóa/mở theo thời gian công khai.
- Trong mục **Tạo đề**, người ra đề có thể chọn Toán, Vật lý hoặc bài kiểm tra linh hoạt.
- Cấu trúc đề Toán: 12 câu trắc nghiệm A–D, 4 câu đúng–sai (mỗi câu 4 ý) và 6 câu trả lời ngắn.
- Cấu trúc đề Vật lý: 18 câu trắc nghiệm A–D, 4 câu đúng–sai (mỗi câu 4 ý) và 6 câu trả lời ngắn.
- Riêng đề Vật lý có khung ảnh tùy chọn **Quy ước và hằng số** trước Phần I.
- Phần trả lời ngắn Vật lý hỗ trợ câu đơn hoặc nhóm nhiều câu dùng chung một ảnh giả thiết; các câu con vẫn được trả lời và chấm điểm độc lập.
- Mỗi câu nhận số ảnh tùy ý bằng thao tác dán, kéo-thả hoặc chọn nhiều tệp; từng ảnh được nén trước khi lưu.
- Người làm phải nhập tên, chọn thời lượng, có đồng hồ đếm ngược, tự lưu bài và tự nộp khi hết giờ.
- Đề Toán/Vật lý chấm tự động trên thang 10 và chỉ hiện điểm sau khi nộp, không công khai đáp án để người làm có thể thử lại.
- Mỗi lượt nộp Toán/Vật lý có thể đăng họ tên và điểm vào danh sách công khai theo từng đề; mọi người truy cập trang đều xem được, còn câu trả lời và đáp án không được công khai.
- Bài kiểm tra linh hoạt cho phép trộn tự do 5 dạng câu: trắc nghiệm, đúng–sai, trả lời ngắn, đục lỗ và tự luận; từng câu có số điểm riêng.
- Bài kiểm tra linh hoạt xác thực email bằng mã 6 ký tự, chấm phần không tự luận trên Apps Script và lưu mỗi lượt nộp thành một file JSON trên Google Drive.
- Bốn giao diện màu, responsive cho máy tính và điện thoại.

Bộ dữ liệu ban đầu không chứa đề minh họa. Khi chưa đăng đề, trang môn học hiển thị trạng thái kho trống.

## Cấu trúc file

| File | Vai trò |
|---|---|
| `index.html` | Trang chủ |
| `math.html`, `physics.html` | Danh sách đề Toán và Vật lý |
| `tests.html` | Danh sách bài kiểm tra linh hoạt |
| `create.html` | Trang chọn môn để tạo đề |
| `create-math.html`, `create-physics.html` | Trình tạo đề Toán và Vật lý |
| `create-flexible.html` | Trình tạo bài kiểm tra linh hoạt |
| `math-exams.js`, `physics-exams.js` | Dữ liệu đề của từng môn |
| `flexible-exams.js` | Dữ liệu câu hỏi công khai, không chứa đáp án |
| `exam.html` | Phòng làm bài dùng chung |
| `test.html` | Phòng làm bài kiểm tra linh hoạt |
| `exam.js` | Hiển thị đề, đếm giờ, lưu bài và chấm điểm theo môn |
| `flexible-core.js` | Schema, kiểm tra dữ liệu và quy tắc chấm 5 dạng câu |
| `flexible-builder.js` | Trình tạo, ảnh, sao lưu và xuất dữ liệu bài kiểm tra |
| `flexible-exam.js` | OTP email, phòng làm bài, gửi bài và lịch sử cục bộ |
| `classic-results.js` | Gửi và hiển thị danh sách công khai người đã làm đề Toán/Vật lý |
| `backend-config.js` | URL Google Apps Script Web App |
| `google-apps-script/` | Backend gửi mã, chấm lại và lưu JSON vào Drive |
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
5. Với đề Lý, có thể dán ảnh quy ước/hằng số trước Phần I. Trong Phần III, chọn **Câu hỏi đơn** hoặc **Câu hỏi gộp**; câu gộp có một khung dữ kiện chung và vẫn giữ các khung câu con riêng.
6. Chọn đáp án đúng cho từng câu/ý. Với trả lời ngắn, dùng dấu `|` cho các đáp án tương đương, ví dụ `1,5|1.5`; mỗi biến thể tối đa 4 ký tự.
7. Bấm **Lưu vào kho đề**, sau đó tải đúng file dữ liệu:
   - Toán: `math-exams.js`.
   - Vật lý: `physics-exams.js`.
8. Thay đúng file cùng tên trong repository rồi commit. Đề sẽ tự mở trên giao diện khi đến thời gian đã đặt.

Trình tạo tự lưu bản nháp và kho đề riêng cho từng môn trên thiết bị. Vẫn nên xuất file sau mỗi lần hoàn thiện để có bản sao dự phòng.

## Tạo bài kiểm tra linh hoạt

1. Mở **Tạo đề → Tạo bài kiểm tra**.
2. Nhập tiêu đề, mã bài, thời gian mở, thời lượng và một hoặc nhiều tên miền email được nhận mã, ví dụ `ad.unsw.edu.au`.
3. Thêm câu theo thứ tự tùy ý. Mỗi câu chọn một trong 5 dạng và nhập số điểm riêng:
   - **Trắc nghiệm:** 2–8 lựa chọn, một đáp án đúng.
   - **Đúng–Sai:** 1–8 ý; điểm câu được chia theo tỷ lệ số ý đúng.
   - **Trả lời ngắn:** có thể nhập nhiều đáp án tương đương, phân cách bằng `|`.
   - **Đục lỗ:** 1–10 ô; điểm câu được chia theo tỷ lệ số ô đúng.
   - **Tự luận:** lưu nội dung để chấm sau, không cộng vào điểm tự động.
4. Mỗi câu có thể có nội dung chữ và nhiều ảnh được dán, kéo-thả hoặc chọn từ thiết bị.
5. Nhấn **Lưu vào kho**, rồi tải ba file:
   - `flexible-exams.js`: thay file cùng tên trên GitHub.
   - `flexible-answer-keys.json`: giữ riêng tư và tải lên Google Drive cho backend đọc; tuyệt đối không đăng lên GitHub.
   - `flexible-builder-backup.json`: bản sao đầy đủ để tiếp tục chỉnh sửa trên thiết bị khác.
6. Làm theo `google-apps-script/README.md` để cấu hình thư mục kết quả, file đáp án riêng, tên miền website và URL Web App.

Tổng điểm tự chấm, tổng điểm tự luận và tổng toàn bài được tính lại trực tiếp từ các câu. Khi nộp, trình duyệt không tự khai điểm: Apps Script dùng file đáp án riêng để chấm lại rồi mới lưu kết quả.

## Dữ liệu kết quả bài kiểm tra

Mỗi lượt nộp tạo một file JSON riêng trong thư mục Drive đã cấu hình, gồm mã bài, phiên bản, họ tên, email đã xác thực, điểm phần không tự luận, điểm tối đa, thời gian và câu trả lời. Nội dung tự luận được lưu để người quản lý chấm sau nhưng không nằm trong `objectiveEarned`.

Người làm phải đồng ý việc lưu họ tên, email, câu trả lời và điểm trước khi nhận mã. Không chia sẻ công khai thư mục kết quả hoặc file đáp án riêng.

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

### 2. Danh sách kết quả Toán/Vật lý công khai

Với đề Toán và Vật lý, lịch sử cá nhân vẫn được giữ trên thiết bị, đồng thời họ tên và điểm của mỗi lượt nộp mới được gửi lên danh sách công khai sau khi người làm đánh dấu đồng ý. Trang danh sách môn hiển thị các lượt nộp gần đây; trang kết quả hiển thị bảng xếp hạng riêng của đề. Câu trả lời và đáp án không xuất hiện trong danh sách này.

Tính năng cần URL Apps Script trong `backend-config.js`. Sau khi thay `Code.gs`, phải cập nhật lại deployment Web App. Lần nộp Toán/Lý đầu tiên sẽ tự tạo file `hana-classic-public-results.json` trong thư mục `RESULTS_FOLDER_ID`.

Apps Script dùng hạn mức gửi mail và Drive của tài khoản Google triển khai. Đây là công cụ kiểm tra/luyện tập có xác thực email, không thay thế một hệ thống khảo thí có giám sát hoặc chống gian lận chuyên dụng.

## Lưu ý về ảnh

- Chấp nhận PNG, JPEG và WebP; có thể chọn nhiều ảnh trong một lần.
- Không đặt giới hạn số ảnh mỗi câu. Từng ảnh được giảm kích thước và chuyển sang WebP trước khi nhúng vào file đề.
- Khung ảnh có kích thước hiển thị cố định và dùng `object-fit: contain`, nên giữ trọn nội dung, đúng tỉ lệ và không bị kéo méo; người làm có thể bấm để phóng to.
- Nhiều ảnh lớn sẽ làm file `*-exams.js` nặng. Nên cắt sát nội dung, dùng ảnh rõ nét và kiểm tra dung lượng trước khi commit.

## Kiểm tra nhanh sau khi cập nhật

- Mở `math.html`, `physics.html` và `tests.html`; kho trống phải hiển thị đúng khi chưa có dữ liệu.
- Kiểm tra **Tạo đề** mở được cả Toán, Lý và bài kiểm tra linh hoạt.
- Xác nhận trình tạo hiển thị đúng 12 câu trắc nghiệm cho Toán và 18 câu cho Vật lý.
- Với Lý, kiểm tra ảnh quy ước xuất hiện trước Phần I; tạo thử một nhóm 2 câu ngắn dùng chung dữ kiện và xác nhận vẫn có đủ 6 ô trả lời, tổng điểm tối đa vẫn là 10.
- Thử thêm, xóa, đổi thứ tự nhiều ảnh trong một câu; kiểm tra khung ảnh và chức năng phóng to trên máy tính lẫn điện thoại.
- Kiểm tra nhập/xuất riêng `math-exams.js` và `physics-exams.js`, không trộn hai kho đề.
- Mở đề trước giờ để kiểm tra trạng thái khóa; đặt một đề thử ở thời gian quá khứ để kiểm tra toàn bộ luồng.
- Thử nhập tên, chọn thời lượng, tải lại khi đang làm và nộp bài; bài đúng toàn bộ ở cả hai môn phải đạt 10,00 điểm.
- Với bài kiểm tra linh hoạt, thử đủ 5 dạng câu, kiểm tra tổng điểm khách quan/tự luận, xác thực đúng tên miền email và xác nhận file JSON xuất hiện trong thư mục Drive sau khi nộp.
- Kiểm tra `flexible-exams.js` không chứa các trường đáp án như `correctOptionId`, `acceptedAnswers` hoặc `answer`.

