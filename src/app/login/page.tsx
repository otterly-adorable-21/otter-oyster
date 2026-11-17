import { LoginForm } from './form';
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px', display: 'grid', gap: 14 }}>
      <h1>Sign in</h1>
      <p>Enter your email and we will send you a sign-in link. There is no password. Use the same email you pay creators with, and your posts unlock automatically.</p>
      <LoginForm next={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} />
    </div>
  );
}
