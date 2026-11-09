// 시험 전용(assetsheet:test) — 자식 프로세스의 fetch 를 가짜 구글로 바꾼다(`tsx --import <이 파일>`). 실제 구글 호출 0.
// 환경 변수 FAKE_GOOGLE_FILE = { values: {'탭!칸': 값}, formulas: {...}, mode: 'ok' | '403' | '400:<탭>' } JSON 파일 경로
import fs from 'node:fs';
const model = JSON.parse(fs.readFileSync(process.env.FAKE_GOOGLE_FILE, 'utf8'));
const colNum = (c) => c.charCodeAt(0) - 64;
const colChr = (n) => String.fromCharCode(64 + n);
function cut(m, range) {
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/);
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(r[2]), Number(r[3])];
  const [c2, r2] = r[4] ? [colNum(r[4]), r[5] ? Number(r[5]) : Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)))] : [c1, r1];
  const rows = [];
  for (let y = r1; y <= r2; y++) {
    const row = [];
    for (let x = c1; x <= c2; x++) row.push(m[`${tab}!${colChr(x)}${y}`] ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') return new Response('{}', { status: 418 }); // 쓰기는 없어야 한다
  if (model.mode === '403') return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
  if (model.mode.startsWith('400:')) return new Response(JSON.stringify({ error: { code: 400, message: `Unable to parse range: '${model.mode.slice(4)}'!B25` } }), { status: 400 });
  const params = new URL(url).searchParams;
  const m = params.get('valueRenderOption') === 'FORMULA' ? model.formulas : model.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
};
