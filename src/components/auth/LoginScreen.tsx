import { useEffect, useRef, useState } from 'react';
import LogoMark from '../layout/LogoMark';

/**
 * 로그인 화면 — **주인 계정 하나**다.
 *
 * ⚠️ 회원가입·아이디·비밀번호 찾기 링크를 두지 않는다. 혼자 쓰는 도구에 가입 화면이 있으면
 * "남도 가입할 수 있다" 로 읽히고, 비밀번호 찾기(메일 발송)는 오히려 뚫릴 구멍이 된다.
 * 비밀번호를 잊었으면 서버에서 `npm run auth:set-password` 를 다시 돌린다.
 */
export default function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword('');
        onSuccess();
        return;
      }
      // 서버 문구를 그대로 보여 준다 — 틀림 / 잠금 N분 / 비밀번호 미설정이 각각 다른 안내다.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `로그인하지 못했습니다 (${res.status})`);
    } catch {
      setError('서버에 연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg-primary p-6">
      <form onSubmit={submit} className="w-[min(360px,90vw)]">
        <div className="mb-6 flex items-center justify-center gap-2 text-accent">
          <LogoMark size={28} />
          <span className="text-xl font-bold">AlphaScope</span>
        </div>

        <label htmlFor="as-password" className="mb-1.5 block text-xs text-text-secondary">
          비밀번호
        </label>
        <input
          id="as-password"
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          /* 크롬 비밀번호 저장이 동작하게 한다 — 매번 손으로 치게 두면 짧은 값을 쓰게 된다 */
          autoComplete="current-password"
          className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        />

        {error && <p className="mt-2 text-xs leading-relaxed text-bearish">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? '확인 중…' : '로그인'}
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-text-muted">
          비밀번호를 잊었으면 서버에서{' '}
          <code className="rounded bg-bg-tertiary px-1">npm run auth:set-password</code>
        </p>
      </form>
    </div>
  );
}
