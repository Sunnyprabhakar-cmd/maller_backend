import React from 'react'

type AuthGateProps = {
  mode: 'loading' | 'setup' | 'login'
  authError: string
  authBusy: boolean
  setupUsername: string
  setSetupUsername: (value: string) => void
  setupPassword: string
  setSetupPassword: (value: string) => void
  setupConfirmPassword: string
  setSetupConfirmPassword: (value: string) => void
  loginUsername: string
  setLoginUsername: (value: string) => void
  loginPassword: string
  setLoginPassword: (value: string) => void
  onCreateAccount: () => Promise<void>
  onSignIn: () => void
}

export function AuthGate(props: AuthGateProps) {
  if (props.mode === 'loading') {
    return (
      <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <section className="card" style={{ width: 460 }}>
          <h2>Loading</h2>
          <div className="muted">Checking account configuration...</div>
        </section>
      </main>
    )
  }

  if (props.mode === 'setup') {
    return (
      <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <section className="card" style={{ width: 460 }}>
          <h2>Create Admin Account</h2>
          <label>Username</label>
          <input value={props.setupUsername} onChange={(event) => props.setSetupUsername(event.target.value)} />
          <label>Password</label>
          <input type="password" value={props.setupPassword} onChange={(event) => props.setSetupPassword(event.target.value)} />
          <label>Confirm password</label>
          <input type="password" value={props.setupConfirmPassword} onChange={(event) => props.setSetupConfirmPassword(event.target.value)} />
          {props.authError ? <div className="danger" style={{ marginTop: 8 }}>{props.authError}</div> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="button" disabled={props.authBusy} onClick={() => void props.onCreateAccount()}>
              {props.authBusy ? 'Creating...' : 'Create account'}
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="main" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <section className="card" style={{ width: 460 }}>
        <h2>Login</h2>
        <label>Username</label>
        <input value={props.loginUsername} onChange={(event) => props.setLoginUsername(event.target.value)} />
        <label>App password</label>
        <input type="password" value={props.loginPassword} onChange={(event) => props.setLoginPassword(event.target.value)} />
        {props.authError ? <div className="danger" style={{ marginTop: 8 }}>{props.authError}</div> : null}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="button" onClick={props.onSignIn}>Sign in</button>
        </div>
      </section>
    </main>
  )
}
