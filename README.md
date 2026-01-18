# Threads Sweeper

Threads 혐오 계정 차단 및 증거 수집 크롬 익스텐션

## 소개

Threads에서 혐오 발언, 조롱, 극우 콘텐츠를 게시하는 계정들과 그 팔로워 네트워크를 효율적으로 차단하고, 필요시 경찰 신고를 위한 증거를 체계적으로 수집하는 도구입니다.

## 주요 기능

### 1. 팔로워 일괄 차단
- 특정 유저의 프로필 페이지에서 팔로워 목록을 가져와 전체 일괄 차단
- 진행 상황 실시간 표시 (예: 127/350 완료)
- 중간에 취소 가능

### 2. 증거 아카이빙
- 차단 대상 유저의 프로필 정보 저장 (유저명, 프로필 URL)
- 해당 유저의 최근 게시물 수집
- 프로필 페이지 스크린샷 캡처
- 각 게시물의 직접 링크
- 수집 일시 (타임스탬프)
- 저장 위치: 로컬 IndexedDB

### 3. PDF 리포트 생성
- 아카이빙된 증거를 신고용 PDF로 출력
- 포함 내용: 유저 정보, 게시물 내용, URL, 수집 일시
- 여러 유저 선택하여 일괄 PDF 생성 가능

## 설치 방법

### 개발자 모드 설치 (권장)

1. 이 저장소를 클론하거나 ZIP으로 다운로드합니다:
   ```bash
   git clone https://github.com/your-username/threads-sweeper.git
   ```

2. Chrome 브라우저에서 `chrome://extensions` 로 이동합니다.

3. 우측 상단의 **개발자 모드**를 활성화합니다.

4. **압축해제된 확장 프로그램을 로드합니다** 버튼을 클릭합니다.

5. 다운로드한 `threads-sweeper` 폴더를 선택합니다.

6. 확장 프로그램이 설치되면 브라우저 툴바에 아이콘이 표시됩니다.

## 사용 방법

### 팔로워 차단하기

1. Threads에서 차단하고자 하는 대상의 프로필 페이지로 이동합니다.
   - 예: `https://www.threads.net/@username`

2. 브라우저 툴바의 Threads Sweeper 아이콘을 클릭합니다.

3. **팔로워 전체 차단** 버튼을 클릭합니다.

4. 확인 대화상자에서 확인을 누르면 차단이 시작됩니다.

5. 진행 상황이 표시되며, 필요시 **취소** 버튼으로 중단할 수 있습니다.

### 증거 수집하기

1. 증거를 수집하고자 하는 대상의 프로필 페이지로 이동합니다.

2. Threads Sweeper 팝업을 열고 **증거 아카이빙** 버튼을 클릭합니다.

3. 프로필 정보, 게시물, 스크린샷이 자동으로 수집됩니다.

4. 수집된 증거는 팝업 하단의 **저장된 증거** 목록에 표시됩니다.

### PDF 리포트 생성하기

1. 저장된 증거 목록에서 PDF로 내보낼 항목을 체크박스로 선택합니다.

2. **PDF 리포트 생성** 버튼을 클릭합니다.

3. 브라우저의 인쇄 대화상자가 열리면 PDF로 저장합니다.

## 폴더 구조

```
threads-sweeper/
├── manifest.json          # Chrome Extension 설정
├── src/
│   ├── background/
│   │   └── service-worker.js   # 백그라운드 서비스 워커
│   ├── content/
│   │   ├── content.js          # 페이지 상호작용 스크립트
│   │   └── content.css         # 콘텐츠 스타일
│   ├── popup/
│   │   ├── popup.html          # 팝업 UI
│   │   ├── popup.css           # 팝업 스타일
│   │   └── popup.js            # 팝업 로직
│   └── utils/
│       ├── storage.js          # IndexedDB 저장소
│       └── pdf-generator.js    # PDF 생성 유틸리티
├── icons/                 # 확장 프로그램 아이콘
└── scripts/               # 개발 스크립트
```

## 기술 스택

- **Chrome Extension Manifest V3**
- **웹 스크래핑 방식** (Threads 공식 API 미사용)
- **IndexedDB** - 로컬 데이터 저장
- **HTML/CSS/JavaScript** - UI 및 로직

## 제약사항

- 자동 혐오 발언 탐지 기능 없음 (사용자가 직접 대상 선택)
- Threads 웹 구조 변경 시 유지보수 필요
- Threads의 이용약관 변경에 따라 기능이 제한될 수 있음

## 주의사항

- 이 도구는 개인의 온라인 안전을 위한 방어적 목적으로 설계되었습니다.
- 수집된 증거는 관련 법률에 따라 적법하게 사용해야 합니다.
- 무분별한 차단이나 증거 수집은 피해주세요.
- 법적 조치가 필요한 경우 전문 법률 상담을 받으시기 바랍니다.

## 라이선스

MIT License

## 기여하기

버그 리포트, 기능 제안, PR을 환영합니다!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request
