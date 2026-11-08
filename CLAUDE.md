# k-salary-net 작업 지침

2026 연봉 ↔ 월 실수령액 계산기. 빌드 없는 정적 사이트이고 `main` 브랜치 루트가 GitHub Pages(https://lcalmsky.github.io/k-salary-net/)로 바로 배포된다.

## 구조

| 파일 | 역할 |
|---|---|
| `data/2026.json` | 요율·상한·한도·세율. 항목마다 `source`(근거 URL)와 `note` 가 있다 |
| `data/simple-tax-2026-03.json` | 근로소득 간이세액표(월급여 × 가족 수 → 세액). `tools/xlsx_to_json.py` 로 만든다 |
| `js/config.js` | `DATA_YEAR`(읽을 연도 파일), 저장소·방문자 배지 설정 |
| `js/engine.js` | 계산 엔진. DOM 을 쓰지 않는 순수 모듈 |
| `js/app.js` | 화면 |
| `tests/engine.test.mjs` | 엔진 테스트. `node --test tests/` |

요율은 코드에 하드코딩하지 않는다. 값이 바뀌면 `data/*.json` 만 고친다.

## 세율 업데이트 요청을 받으면

1. 아래 표의 **확인처**에서 새 값과 시행일을 읽는다. 웹 조회는 keenable 도구를 쓰고, 홈택스처럼 스크립트로 열리지 않는 곳은 aside 브라우저로 연다.
2. `data/2026.json` 의 해당 키를 고치고, `source` 를 실제로 읽은 URL 로, `note` 를 새 근거로 바꾼다. 1차 자료(법령·공단·국세청)를 못 찾고 2차 자료로만 확인했으면 `note` 에 그렇게 적는다.
3. 테스트 기대값 중 바뀐 값에 걸린 것(`tests/engine.test.mjs`)을 새 값으로 고치고 `node --test tests/` 를 돌린다.
4. 사용자에게 무엇이 얼마에서 얼마로 바뀌었는지 표로 보고한 뒤, 커밋·push 한다. push 하면 약 1분 뒤 사이트에 반영된다.

연도가 바뀌면 `data/2026.json` 을 `data/2027.json` 으로 복사해 고치고 `js/config.js` 의 `DATA_YEAR` 를 바꾼다.

## 항목별 데이터 위치와 확인처

| 항목 | `data/2026.json` 키 | 확인처 | 보통 바뀌는 시기 |
|---|---|---|---|
| 국민연금 요율 | `pension.employeeRate` (근로자분 = 총 요율 ÷ 2) | 국민연금공단 보험료 안내 https://nps.or.kr/eng/ntnlpnsplan/cntb/getOHAI0013M0.do , 국민연금법 시행령 | 1월 (2026~2033 매년 0.5%p 인상 예정) |
| 국민연금 기준소득월액 상·하한 | `pension.caps[]` (1~6월, 7~12월 두 구간) | 국민연금공단 공지 https://nps.or.kr/comm/quick/getOHAH0011P0.do (보건복지부 고시) | 매년 7월 |
| 국민연금 적용 나이 | `pension.ageExemptFrom` | 국민연금법 §6 | 거의 안 바뀜 |
| 건강보험 요율 | `health.employeeRate`, `health.totalRate` | 국민건강보험공단 EDI 공지 https://edi.nhis.or.kr (건강보험정책심의위원회 결정, 보건복지부 고시) | 1월 (전년 8~11월 결정) |
| 장기요양보험 요율 | `ltc.totalRate`, `ltc.healthRate` | 같은 EDI 공지. 보험료 = 건강보험료 × 장기요양요율 ÷ 건강보험요율 | 1월 |
| 고용보험 요율 | `employment.employeeRate` | 고용보험 및 산재보험료징수법 시행령 §12 (실업급여 총 요율 ÷ 2) | 변경 시 |
| 단시간근로 4대보험 제외 | `shortTime.minimumWageHourly`, `shortTime.monthlyHours` | 최저임금 고시(고용노동부, 국가법령정보센터 행정규칙). 60시간 기준은 국민연금법·국민건강보험법·고용보험법 시행령 | 최저임금은 매년 1월 |
| 근로소득 간이세액표 | `simpleTable.file`, `simpleTable.effective`, 표 파일 자체 | 홈택스 → 세금신고 → 원천세 신고 → 근로소득 간이세액표 → 최신 시행분 "엑셀 다운로드". 아래 「간이세액표 교체」 참고 | 세법 개정 시 (보통 3월) |
| 간이세액표 자녀 공제액 | `simpleTable.childDeduction` (1명·2명·추가 1명당) | 같은 홈택스 페이지의 「개정내용」 문단, 소득세법 시행령 별표2 | 간이세액표와 같이 |
| 월급여 1,000만원 초과 공식 | `simpleTable.over10m[]` (구간별 base·rate·mult) | 간이세액표 엑셀 「근로소득간이세액표」 시트 맨 아래 「10,000천원 초과」 행들 | 간이세액표와 같이 |
| 원천징수 비율 80/100/120% | `simpleTable.ratios` | 소득세법 시행령 §194 | 거의 안 바뀜 |
| 지방소득세 | `localIncomeTaxRate` | 지방세법 §92 | 거의 안 바뀜 |
| 비과세 한도 (식대·자가운전·보육·연구·취재·벽지·승선·이전지원금) | `nontax.<항목>.cap` (보육수당만 `nontax.childcare.capPerKid`·`maxKids`·`maxAge`) | 소득세법 §12, 시행령 §12 | 세법 개정 시 (1월) |
| 국외근로 비과세 | `nontax.overseas.cap`, `specialCap` | 소득세법 시행령 §16 | 세법 개정 시 |
| 생산직 연장근로수당 비과세 | `nontax.productionOvertime` (연 한도, 월정액급여 상한, 직전연도 총급여 상한) | 소득세법 시행령 §17 | 세법 개정 시 |
| 중소기업 취업자 감면 | `smeReduction` (청년·기타 감면율, 기간, 연 한도, 취업 기한) | 조세특례제한법 §30, 국세청 안내 https://nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=239023&mi=40632 | 일몰 연장 시 (`hireDeadline` 확인) |
| 일용근로자 | `daily` (1일 공제액, 세율, 세액공제율, 소액부징수) | 소득세법 §47②·§59③·§86·§129 | 세법 개정 시 |
| 외국인 단일세율 | `foreignFlat` (세율, 적용 기간, 기한) | 조세특례제한법 §18의2 | 일몰 연장 시 |
| 기본세율·근로소득공제·인적공제 | `incomeTax` (월 원천징수에는 안 쓰고 참고용) | 소득세법 §55·§47·§50 | 세법 개정 시 |

시행일이 정해졌지만 아직 시행 전인 개정(예: 국회 계류 중인 세법 개정안)은 반영하지 않는다. 시행일이 지나야 바꾼다.

## 간이세액표 교체

1. 홈택스에서 최신 시행분 엑셀을 내려받는다. 딥링크는 메인으로 튕기므로 상단 검색창에 「근로소득 간이세액표」를 검색하거나 메뉴로 들어간다.
2. 변환한다. openpyxl 이 필요하다.
   ```bash
   python3 -I tools/xlsx_to_json.py "<내려받은 파일>.xlsx" 2027-03-01 > data/simple-tax-2027-03.json
   ```
   2026-03-01 시행분 엑셀로 돌리면 지금의 `data/simple-tax-2026-03.json` 과 행·10,000천원 값이 정확히 같게 나온다.
3. `data/2026.json` 의 `simpleTable.file`, `simpleTable.effective`, `simpleTable.source` 를 바꾼다. 엑셀 맨 아래 「10,000천원 초과」 공식과 「개정내용」의 자녀 공제액이 바뀌었으면 `over10m`, `childDeduction` 도 고친다.
4. `tests/engine.test.mjs` 의 간이세액표 조회 기대값(`tableTax(...)`)을 새 표 값으로 고친다.

## 아직 확인하지 못한 값

- 건강보험 보수월액 상·하한: 2026년 고시값을 못 찾아서 상·하한 없이 계산한다. 찾으면 `health` 에 추가하고 `js/engine.js` 의 건강보험 계산에 반영한다.
- 국민연금 1~6월 상·하한(637만/40만): 2차 자료로만 확인했다.

## 배포

- 저장소 `lcalmsky/k-salary-net`. 이 PC의 gh 활성 계정은 회사 계정이므로 전환하지 말고, push 할 때만 lcalmsky 토큰을 쓴다.
  ```bash
  T=$(gh auth token --hostname github.com --user lcalmsky)
  git -c credential.helper= -c "credential.helper=!f(){ echo username=lcalmsky; echo password=$T; }; f" push
  ```
- 배포 완료는 `GH_TOKEN=$T gh api repos/lcalmsky/k-salary-net/pages/builds/latest` 의 `commit` 이 방금 push 한 커밋이고 `status` 가 `built` 인지로 판정한다.
- 방문자 배지(hits.sh)는 `lcalmsky.github.io` 에서 열릴 때만 불러온다. 배지 URL 을 직접 호출하면 방문 수가 오르므로 확인용으로 부르지 않는다.
