import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AuthGate } from './AuthGate'

afterEach(() => {
  cleanup()
})

function renderAuthGate(overrides: Partial<React.ComponentProps<typeof AuthGate>> = {}) {
  return render(
    <AuthGate
      mode="login"
      authError=""
      authBusy={false}
      setupUsername=""
      setSetupUsername={mock.fn()}
      setupPassword=""
      setSetupPassword={mock.fn()}
      setupConfirmPassword=""
      setSetupConfirmPassword={mock.fn()}
      loginUsername=""
      setLoginUsername={mock.fn()}
      loginPassword=""
      setLoginPassword={mock.fn()}
      onCreateAccount={mock.fn(async () => undefined)}
      onSignIn={mock.fn()}
      {...overrides}
    />
  )
}

describe('AuthGate', () => {
  it('renders loading state', () => {
    renderAuthGate({ mode: 'loading' })

    assert.ok(screen.getByRole('heading', { name: 'Loading' }))
    assert.ok(screen.getByText('Checking account configuration...'))
  })

  it('renders setup state and invokes create account handler', () => {
    const onCreateAccount = mock.fn(async () => undefined)

    renderAuthGate({
      mode: 'setup',
      setupUsername: 'admin',
      setupPassword: 'secret',
      setupConfirmPassword: 'secret',
      authError: 'Passwords do not match.',
      onCreateAccount
    })

    assert.ok(screen.getByRole('heading', { name: 'Create Admin Account' }))
    assert.ok(screen.getByDisplayValue('admin'))
    assert.ok(screen.getByText('Passwords do not match.'))

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    assert.equal(onCreateAccount.mock.callCount(), 1)
  })

  it('renders login state, forwards input updates, and invokes sign in', () => {
    const setLoginUsername = mock.fn()
    const setLoginPassword = mock.fn()
    const onSignIn = mock.fn()

    renderAuthGate({
      mode: 'login',
      loginUsername: 'sunny',
      loginPassword: 'hunter2',
      setLoginUsername,
      setLoginPassword,
      onSignIn
    })

    assert.ok(screen.getByRole('heading', { name: 'Login' }))

    const usernameInput = screen.getByDisplayValue('sunny')
    const passwordInput = screen.getByDisplayValue('hunter2')

    fireEvent.change(usernameInput, { target: { value: 'sunny2' } })
    fireEvent.change(passwordInput, { target: { value: 'hunter3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    assert.equal(setLoginUsername.mock.callCount() > 0, true)
    assert.equal(setLoginPassword.mock.callCount() > 0, true)
    assert.equal(onSignIn.mock.callCount(), 1)
  })
})
