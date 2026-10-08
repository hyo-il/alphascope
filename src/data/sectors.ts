/**
 * yfinance 섹터·세부 업종 → 한국어 (v2.42.0 — 섹터 표는 `server/heatmap.ts` 에서 옮겼다. 종목 지도·섹터 연구·기업정보가 같은 표를 쓴다).
 * ⚠️ 세부 업종(industry)은 한글 이름이 **있는 것만** 적는다 — 없으면 화면에서 감춘다(영어로 두지 않는다).
 *    이름은 yfinance 표기 그대로를 키로 쓴다(대시 `—` 포함). 새 업종을 더할 때는 뜻이 분명한 것만.
 */
export const SECTOR_KO: Record<string, string> = {
  Technology: '기술',
  'Communication Services': '커뮤니케이션',
  'Consumer Cyclical': '경기소비재',
  'Consumer Defensive': '필수소비재',
  'Financial Services': '금융',
  Healthcare: '헬스케어',
  Industrials: '산업재',
  Energy: '에너지',
  Utilities: '유틸리티',
  'Real Estate': '부동산',
  'Basic Materials': '소재',
};

export const INDUSTRY_KO: Record<string, string> = {
  Semiconductors: '반도체',
  'Semiconductor Equipment & Materials': '반도체 장비·소재',
  'Consumer Electronics': '가전·전자기기',
  'Electronic Components': '전자 부품',
  'Software—Infrastructure': '소프트웨어(인프라)',
  'Software—Application': '소프트웨어(응용)',
  'Internet Content & Information': '인터넷 서비스',
  'Internet Retail': '온라인 소매',
  'Auto Manufacturers': '자동차',
  'Auto Parts': '자동차 부품',
  'Banks—Diversified': '은행',
  'Banks—Regional': '지역 은행',
  'Insurance—Life': '생명보험',
  'Insurance—Property & Casualty': '손해보험',
  'Capital Markets': '증권·자본시장',
  'Credit Services': '카드·신용 서비스',
  'Drug Manufacturers—General': '제약',
  'Drug Manufacturers—Specialty & Generic': '제약(전문·복제약)',
  Biotechnology: '바이오',
  'Medical Devices': '의료기기',
  'Oil & Gas Integrated': '석유·가스(종합)',
  'Specialty Chemicals': '특수 화학',
  Chemicals: '화학',
  Steel: '철강',
  'Aerospace & Defense': '항공우주·방산',
  'Specialty Industrial Machinery': '산업 기계',
  'Electrical Equipment & Parts': '전기 장비',
  Shipbuilding: '조선',
  'Marine Shipping': '해운',
  'Telecom Services': '통신',
  'Entertainment': '엔터테인먼트',
  'Electronic Gaming & Multimedia': '게임',
  'Utilities—Regulated Electric': '전력',
  'Packaged Foods': '가공식품',
  'Tobacco': '담배',
  'Household & Personal Products': '생활용품·화장품',
  'Discount Stores': '할인점',
  'Restaurants': '외식',
  'Information Technology Services': 'IT 서비스',
  'Communication Equipment': '통신 장비',
  'Computer Hardware': '컴퓨터 하드웨어',
  'Solar': '태양광',
};

/** 섹터 한국어 — 표에 없으면 원래 이름, 값이 없으면 「기타」 (종목 지도·섹터 연구와 같은 분류) */
export const sectorKo = (sector: string | null | undefined) => (sector ? SECTOR_KO[sector] ?? sector : '기타');
/** 세부 업종 한국어 — 표에 없으면 null(화면에서 감춘다) */
export const industryKo = (industry: string | null | undefined) => (industry ? INDUSTRY_KO[industry] ?? null : null);
