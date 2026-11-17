import React, { useState } from 'react';

interface AuthScreenProps {
  configured: boolean;
  authError: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  configured,
  authError,
  onSignIn,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError('Please enter your staff email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const combinedError = localError || authError;

  if (!configured) {
    return (
      <main className="auth-container">
        <section className="card auth-card" aria-labelledby="setup-heading">
          <h2 id="setup-heading" className="section-title">
            Firebase Setup Required
          </h2>
          <p className="muted-text">
            Access to customer and order features is blocked until Firebase Authentication and Cloud
            Firestore are configured.
          </p>

          <div className="notice notice-warning" role="status">
            <strong>No Firebase configuration detected</strong>
            <p>
              Environment variables (<code>VITE_FIREBASE_API_KEY</code>,{' '}
              <code>VITE_FIREBASE_AUTH_DOMAIN</code>, <code>VITE_FIREBASE_PROJECT_ID</code>,{' '}
              <code>VITE_FIREBASE_APP_ID</code>) are not set.
            </p>
          </div>

          <ol className="setup-steps">
            <li>
              Copy <code>.env.example</code> to <code>.env.local</code>.
            </li>
            <li>Add your Firebase Web App credentials to <code>.env.local</code>.</li>
            <li>
              Deploy <code>firestore.rules</code> and <code>firestore.indexes.json</code>.
            </li>
            <li>
              Enable Email/Password sign-in in Firebase Authentication and add staff UIDs to{' '}
              <code>staffUsers</code>.
            </li>
            <li>Restart the dev server or rebuild the app.</li>
          </ol>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-container">
      <section className="card auth-card" aria-labelledby="signin-heading">
        <h2 id="signin-heading" className="section-title">
          Staff Sign In
        </h2>
        <p className="muted-text">
          Internal order desk for authorised bakery staff only. Public self-registration is
          disabled.
        </p>

        {combinedError && (
          <div className="notice notice-error" role="alert">
            {combinedError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="stack-md" noValidate>
          <div className="field">
            <label htmlFor="staff-email">Staff Email</label>
            <input
              id="staff-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@yourshop.example"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="staff-password">Password</label>
            <input
              id="staff-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="help-text">
            Need an account? Ask the shop owner to create your login in Firebase Authentication and
            add your UID to <code>staffUsers</code>.
          </p>
        </form>
      </section>
    </main>
  );
};
