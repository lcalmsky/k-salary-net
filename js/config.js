// 사용하는 연도 데이터 파일. 새 연도 자료를 추가하면 이 값만 바꾼다.
export const DATA_YEAR = 2026;

export const SITE = {
  // GitHub 저장소(OWNER/REPO). 상단 Star 버튼 링크에 쓰인다.
  REPO: 'lcalmsky/k-salary-net',
  // 방문자 수 배지(hits.sh SVG). 이 주소를 불러올 때마다 방문 수가 1 오른다. 비우면 배지를 숨긴다.
  COUNTER_BADGE: 'https://hits.sh/lcalmsky.github.io/k-salary-net.svg?view=today-total&style=flat-square&label=%EB%B0%A9%EB%AC%B8%20%EC%98%A4%EB%8A%98%2F%EC%A0%84%EC%B2%B4&color=1f6f5c&labelColor=555555',
  // 이 호스트에서 열렸을 때만 배지를 불러온다. 로컬 개발 중 방문이 세어지지 않게 한다.
  COUNTER_HOST: 'lcalmsky.github.io',
};
