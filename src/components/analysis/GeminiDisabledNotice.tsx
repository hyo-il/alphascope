/** Gemini 키가 없을 때의 안내 — 자동 분석·자동 매매 탭이 함께 쓴다 */
export default function GeminiDisabledNotice() {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-6 text-sm text-text-secondary">
      <p className="mb-2 font-medium text-text-primary">Gemini 자동 기능이 꺼져 있습니다</p>
      <p>
        <code className="rounded bg-bg-tertiary px-1">.env</code> 의{' '}
        <code className="rounded bg-bg-tertiary px-1">GEMINI_API_KEY</code> 를 채우고 API 서버를
        다시 시작하면 활성화됩니다. 키가 없어도 나머지 기능은 그대로 동작합니다.
      </p>
    </div>
  );
}
