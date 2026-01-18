// PDF Report Generator using jsPDF
// Generates evidence reports for reporting purposes

export class PDFGenerator {
  constructor() {
    this.jsPDF = null;
    this.loaded = false;
  }

  async loadJsPDF() {
    if (this.loaded) return;

    // Dynamic import of jsPDF
    // Note: In production, you might want to bundle this or load from CDN
    try {
      // For Chrome extension, we'll use a simplified approach
      // In a real implementation, you'd include jsPDF in the extension
      this.loaded = true;
    } catch (error) {
      console.error('Failed to load jsPDF:', error);
      throw error;
    }
  }

  async generate(archives) {
    // Create PDF manually without external dependencies
    // This is a simplified implementation

    const content = this.generateHTMLReport(archives);

    // Convert to PDF using browser's print functionality
    // For a full implementation, include jsPDF library

    // For now, return as a text/html blob that can be printed to PDF
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });

    // Open print dialog
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');

    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }

    return blob;
  }

  generateHTMLReport(archives) {
    const timestamp = new Date().toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let html = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Threads 증거 수집 리포트</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Nanum Gothic', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 210mm;
      margin: 0 auto;
      padding: 20mm;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #333;
    }

    .header h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }

    .header .subtitle {
      font-size: 14px;
      color: #666;
    }

    .meta-info {
      background: #f5f5f5;
      padding: 15px;
      margin-bottom: 30px;
      border-radius: 4px;
    }

    .meta-info p {
      margin: 5px 0;
      font-size: 12px;
    }

    .profile-section {
      margin-bottom: 40px;
      page-break-inside: avoid;
    }

    .profile-header {
      background: #333;
      color: white;
      padding: 15px;
      margin-bottom: 20px;
    }

    .profile-header h2 {
      font-size: 18px;
      margin-bottom: 5px;
    }

    .profile-header .handle {
      font-size: 14px;
      opacity: 0.8;
    }

    .profile-details {
      margin-bottom: 20px;
    }

    .profile-details table {
      width: 100%;
      border-collapse: collapse;
    }

    .profile-details th,
    .profile-details td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }

    .profile-details th {
      width: 150px;
      background: #f9f9f9;
      font-weight: 600;
    }

    .posts-section h3 {
      font-size: 16px;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ddd;
    }

    .post-item {
      margin-bottom: 20px;
      padding: 15px;
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 4px;
      page-break-inside: avoid;
    }

    .post-item .post-content {
      margin-bottom: 10px;
      white-space: pre-wrap;
    }

    .post-item .post-meta {
      font-size: 11px;
      color: #666;
    }

    .post-item .post-url {
      font-size: 10px;
      color: #0066cc;
      word-break: break-all;
    }

    .screenshot {
      margin: 20px 0;
      text-align: center;
    }

    .screenshot img {
      max-width: 100%;
      border: 1px solid #ddd;
    }

    .screenshot .caption {
      font-size: 11px;
      color: #666;
      margin-top: 5px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #333;
      text-align: center;
      font-size: 11px;
      color: #666;
    }

    .disclaimer {
      margin-top: 20px;
      padding: 15px;
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 4px;
      font-size: 11px;
    }

    @media print {
      body {
        padding: 15mm;
      }

      .profile-section {
        page-break-before: always;
      }

      .profile-section:first-of-type {
        page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📋 Threads 증거 수집 리포트</h1>
    <p class="subtitle">Evidence Collection Report</p>
  </div>

  <div class="meta-info">
    <p><strong>리포트 생성 일시:</strong> ${timestamp}</p>
    <p><strong>수집 대상 계정 수:</strong> ${archives.length}개</p>
    <p><strong>생성 도구:</strong> Threads Sweeper Extension v1.0.0</p>
  </div>
`;

    // Add each archive
    for (let i = 0; i < archives.length; i++) {
      const archive = archives[i];
      html += this.generateProfileSection(archive, i + 1);
    }

    html += `
  <div class="disclaimer">
    <strong>⚠️ 주의사항:</strong> 이 리포트는 증거 수집 목적으로 생성되었습니다.
    수집된 정보는 관련 법률에 따라 적법하게 사용되어야 하며,
    무단 배포 또는 오용 시 법적 책임이 발생할 수 있습니다.
  </div>

  <div class="footer">
    <p>Generated by Threads Sweeper | ${timestamp}</p>
    <p>이 문서는 법적 증거로 사용될 수 있습니다. 원본 데이터는 로컬에 보관됩니다.</p>
  </div>
</body>
</html>
`;

    return html;
  }

  generateProfileSection(archive, index) {
    const collectedAt = new Date(archive.timestamp).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let html = `
  <div class="profile-section">
    <div class="profile-header">
      <h2>${index}. ${archive.displayName || archive.username}</h2>
      <p class="handle">@${archive.username}</p>
    </div>

    <div class="profile-details">
      <table>
        <tr>
          <th>사용자명</th>
          <td>@${archive.username}</td>
        </tr>
        <tr>
          <th>표시 이름</th>
          <td>${archive.displayName || '-'}</td>
        </tr>
        <tr>
          <th>프로필 URL</th>
          <td>${archive.profileUrl}</td>
        </tr>
        <tr>
          <th>팔로워 수</th>
          <td>${archive.followerCount || '-'}</td>
        </tr>
        <tr>
          <th>소개</th>
          <td>${archive.bio || '-'}</td>
        </tr>
        <tr>
          <th>수집 일시</th>
          <td>${collectedAt}</td>
        </tr>
      </table>
    </div>
`;

    // Add posts
    if (archive.posts && archive.posts.length > 0) {
      html += `
    <div class="posts-section">
      <h3>📝 수집된 게시물 (${archive.posts.length}개)</h3>
`;

      for (let i = 0; i < archive.posts.length; i++) {
        const post = archive.posts[i];
        html += `
      <div class="post-item">
        <div class="post-content">${this.escapeHtml(post.content || '[내용 없음]')}</div>
        <div class="post-meta">게시 시간: ${post.timestamp || '알 수 없음'}</div>
        <div class="post-url">URL: ${post.url}</div>
      </div>
`;
      }

      html += `
    </div>
`;
    }

    // Add screenshots
    if (archive.screenshots && archive.screenshots.length > 0) {
      html += `
    <div class="screenshots-section">
      <h3>📷 스크린샷</h3>
`;

      for (let i = 0; i < archive.screenshots.length; i++) {
        const screenshot = archive.screenshots[i];
        html += `
      <div class="screenshot">
        <img src="${screenshot.data}" alt="Screenshot ${i + 1}">
        <p class="caption">캡처 시간: ${new Date(screenshot.timestamp).toLocaleString('ko-KR')}</p>
      </div>
`;
      }

      html += `
    </div>
`;
    }

    html += `
  </div>
`;

    return html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Alternative: Generate using jsPDF (if loaded)
  async generateWithJsPDF(archives) {
    // This would use the actual jsPDF library
    // For now, fall back to HTML
    return this.generate(archives);
  }
}
