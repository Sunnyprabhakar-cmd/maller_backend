import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AuthGate } from './AuthGate'

afterEach(() => {
  cleanup()
})

function AuthGateHarness() {
  const [mode, setMode] = useState<'setup' | 'login'>('setup')
  const [authError, setAuthError] = useState('')
  const [authBusy] = useState(false)
  const [setupUsername, setSetupUsername] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)

  if (signedIn) {
    return <div>Signed in as {loginUsername}</div>
  }

  return (
    <AuthGate
      mode={mode}
      authError={authError}
      authBusy={authBusy}
      setupUsername={setupUsername}
      setSetupUsername={setSetupUsername}
      setupPassword={setupPassword}
      setSetupPassword={setSetupPassword}
      setupConfirmPassword={setupConfirmPassword}
      setSetupConfirmPassword={setSetupConfirmPassword}
      loginUsername={loginUsername}
      setLoginUsername={setLoginUsername}
      loginPassword={loginPassword}
      setLoginPassword={setLoginPassword}
      onCreateAccount={async () => {
        if (!setupUsername.trim() || !setupPassword.trim()) {
          setAuthError('Username and password are required.')
          return
        }
        if (setupPassword !== setupConfirmPassword) {
          setAuthError('Passwords do not match.')
          return
        }
        setAuthError('Account created. Please sign in.')
        setLoginUsername(setupUsername.trim())
        setLoginPassword('')
        setMode('login')
      }}
      onSignIn={() => {
        if (!loginUsername.trim() || !loginPassword.trim()) {
          setAuthError('Invalid username or password')
          return
        }
        setAuthError('')
        setSignedIn(true)
      }}
    />
  )
}

describe('AuthGate stateful flow', () => {
  it('moves from setup to login and then signed-in state through parent-owned state', () => {
    render(<AuthGateHarness />)

    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0]!, { target: { value: 'sunny' } })

    const passwordInputs = screen.getAllByDisplayValue('')
      .filter((element) => (element as HTMLInputElement).type === 'password')
    fireEvent.change(passwordInputs[0]!, { target: { value: 'secret123' } })
    fireEvent.change(passwordInputs[1]!, { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    assert.ok(screen.getByRole('heading', { name: 'Login' }))
    assert.ok(screen.getByText('Account created. Please sign in.'))
    assert.ok(screen.getByDisplayValue('sunny'))

    const loginPasswordInput = screen.getByDisplayValue('')
    fireEvent.change(loginPasswordInput, { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    assert.ok(screen.getByText('Signed in as sunny'))
  })
})
