import Input from '../ui/Input';
import Button from '../ui/Button';
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
      <form onSubmit={submit} className="w-[min(360px,90vw)] rounded-xl bg-bg-secondary p-6">
        {/* 로고 도형만 파랑, 글자는 흰색 — 사이드 메뉴와 같다 (v2.36.0) */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="text-accent">
            <LogoMark size={28} />
          </span>
          <span className="text-xl font-semibold text-text-primary">AlphaScope</span>
        </div>

        <label htmlFor="as-password" className="mb-1.5 block text-xs text-text-secondary">
          비밀번호
        </label>
        <Input
          id="as-password"
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          /* 크롬 비밀번호 저장이 동작하게 한다 — 매번 손으로 치게 두면 짧은 값을 쓰게 된다 */
          autoComplete="current-password"
          className="w-full" />

        {error && <p className="mt-2 text-xs leading-relaxed text-danger">{error}</p>}

        <Button variant="primary" size="md"
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full">
          {busy ? '확인 중…' : '로그인'}
        </Button>

        <p className="mt-5 text-center text-caption leading-relaxed text-text-muted">
          비밀번호를 잊었으면 서버에서{' '}
          <code className="rounded bg-bg-tertiary px-1">npm run auth:set-password</code>
        </p>
      </form>
    </div>
  );
}
