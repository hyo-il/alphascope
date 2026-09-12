/**
 * 한글 자모 분해 — 종목 검색이 **조합 중인 글자**와 초성 입력을 받아들이기 위한 것.
 *
 * ⚠️ 한글은 조합형이라 "애플" 을 치는 동안 입력창의 값이
 * `ㅇ` → `애` → `애프` → `애플` 로 바뀐다. 글자 단위로만 비교하면 **"애프" 에서 0건**이 되고,
 * 그 자리에서 멈춘 사용자에게는 "한글 검색이 안 된다" 로 보인다 (실제 신고).
 * 자모로 풀면 `ㅇㅐㅍㅡ` 가 `ㅇㅐㅍㅡㄹ` 의 앞부분이라 그대로 이어진다.
 */

const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];
const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;

const isSyllable = (code: number) => code >= SYLLABLE_START && code <= SYLLABLE_END;

/** 한글이 하나라도 있으면 true (자모만 친 상태도 한글로 본다) */
export function hasHangul(text: string): boolean {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

/**
 * 문자열을 자모 열로 편다. 한글이 아닌 글자는 소문자로 그대로 둔다
 * ("애플3" 처럼 섞인 이름도 한 문자열로 비교하기 위해서다).
 */
export function toJamo(text: string): string {
  let out = '';

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (isSyllable(code)) {
      const index = code - SYLLABLE_START;
      out += CHO[Math.floor(index / 588)];
      out += JUNG[Math.floor((index % 588) / 28)];
      out += JONG[index % 28];
    } else {
      out += char.toLowerCase();
    }
  }

  return out;
}

/** 초성만 뽑는다 ("엔비디아" → "ㅇㅂㄷㅇ"). 한글이 아닌 글자는 그대로 둔다. */
export function toChoseong(text: string): string {
  let out = '';

  for (const char of text) {
    const code = char.charCodeAt(0);
    out += isSyllable(code)
      ? CHO[Math.floor((code - SYLLABLE_START) / 588)]
      : char.toLowerCase();
  }

  return out;
}

/** 입력이 초성(과 공백)만으로 이뤄졌는지 — "ㅇㅂㄷㅇ" 같은 검색을 구분한다 */
export function isChoseongOnly(text: string): boolean {
  const trimmed = text.replace(/\s/g, '');
  return trimmed.length > 0 && [...trimmed].every((char) => CHO.includes(char));
}
