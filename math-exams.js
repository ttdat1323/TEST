/*
 * Kho dữ liệu đề Toán.
 * File này được tạo/cập nhật bởi create-math.html rồi đưa lên GitHub Pages.
 */
(function createDefaultExamCatalog() {
  function demoImage(title, subtitle) {
    const safeTitle = String(title).replace(/[<>&"']/g, '');
    const safeSubtitle = String(subtitle).replace(/[<>&"']/g, '');
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="520" viewBox="0 0 1400 520">',
      '<rect width="1400" height="520" fill="#fffdf8"/>',
      '<rect x="24" y="24" width="1352" height="472" rx="24" fill="#f6f0e5" stroke="#1e3a2f" stroke-width="3" stroke-dasharray="14 10"/>',
      '<circle cx="130" cy="130" r="55" fill="#1e3a2f"/>',
      '<text x="130" y="145" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="700" fill="#ffffff">∑</text>',
      '<text x="220" y="220" font-family="Georgia,serif" font-size="54" font-weight="700" fill="#1e3a2f">' + safeTitle + '</text>',
      '<text x="220" y="292" font-family="Arial,sans-serif" font-size="30" fill="#52615a">' + safeSubtitle + '</text>',
      '<text x="220" y="358" font-family="Arial,sans-serif" font-size="24" fill="#8b6f5a">Đây là đề minh họa chức năng — không phải câu hỏi thi thật.</text>',
      '</svg>'
    ].join('');
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  const mcAnswers = ['A', 'B', 'C', 'D', 'A', 'C', 'B', 'D', 'A', 'B', 'D', 'C'];
  const tfAnswers = [
    [true, false, true, false],
    [false, true, true, false],
    [true, true, false, false],
    [false, false, true, true]
  ];
  const shortAnswers = ['2', '-1', '1.5', '0', '12', '3.14'];

  window.MATH_EXAMS = [
    {
      id: 'de-minh-hoa-chuc-nang',
      title: 'Đề minh họa chức năng',
      description: 'Đề mẫu giúp bạn thử nhập tên, chọn thời gian, làm bài, nộp bài và xem cách tính điểm. Nội dung ảnh chỉ là chỗ giữ chỗ.',
      publishAt: '2020-01-01T00:00:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
      standardDuration: 90,
      version: 1,
      demo: true,
      sections: {
        multipleChoice: mcAnswers.map(function mapMc(answer, index) {
          return {
            image: demoImage('Phần I · Câu ' + (index + 1), 'Chọn một đáp án đúng trong A, B, C, D.'),
            answer: answer
          };
        }),
        trueFalse: tfAnswers.map(function mapTf(answers, index) {
          return {
            image: demoImage('Phần II · Câu ' + (index + 1), 'Chọn Đúng hoặc Sai cho từng ý a, b, c, d.'),
            answers: answers
          };
        }),
        shortAnswer: shortAnswers.map(function mapShort(answer, index) {
          return {
            image: demoImage('Phần III · Câu ' + (index + 1), 'Nhập đáp án ngắn, tối đa 4 ký tự.'),
            answer: answer
          };
        })
      }
    }
  ];
})();
