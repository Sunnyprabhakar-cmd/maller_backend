import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTemplateVariables,
  buildInterpolatedTextFallback,
  interpolateTemplate,
  normalizeLinkUrl,
  bodyContainsCidImage
} from './email-layout.js'

test('buildTemplateVariables merges campaign and recipient fields with defaults', () => {
  const vars = buildTemplateVariables(
    {
      companyName: 'Acme',
      headerCompanyName: 'Acme Header',
      footerCompanyName: 'Acme Footer',
      companyAddress: '123 Road',
      companyContact: 'support@example.com',
      contactNumber: '+1-555-1234',
      ctaUrl: 'https://example.com/offer',
      whatsappUrl: 'https://wa.me/123',
      youtubeUrl: 'https://youtube.com/acme'
    },
    {
      email: 'user@example.com',
      name: 'User',
      customFields: {
        offer_code: 'ABC123',
        unsubscribe_url: 'https://example.com/unsub',
        favorite_color: 'blue'
      }
    },
    {
      campaign_name: 'Launch'
    }
  )

  assert.equal(vars.name, 'User')
  assert.equal(vars.email, 'user@example.com')
  assert.equal(vars.company_name, 'Acme')
  assert.equal(vars.header_company_name, 'Acme Header')
  assert.equal(vars.footer_company_name, 'Acme Footer')
  assert.equal(vars.offer_code, 'ABC123')
  assert.equal(vars.unsubscribe_url, 'https://example.com/unsub')
  assert.equal(vars.favorite_color, 'blue')
  assert.equal(vars.campaign_name, 'Launch')
})

test('interpolateTemplate replaces spaced placeholders', () => {
  const result = interpolateTemplate('Hi {{ name }}, use {{offer_code}}.', {
    name: 'Sunny',
    offer_code: 'ZX9'
  })

  assert.equal(result, 'Hi Sunny, use ZX9.')
})

test('buildInterpolatedTextFallback falls back from html and normalizes spaces', () => {
  const result = buildInterpolatedTextFallback(
    '',
    { name: 'User', offer_code: 'AB12' },
    '<h1>Hello {{name}}</h1><p>Your code is {{offer_code}}</p>'
  )

  assert.equal(result, 'Hello User Your code is AB12')
})

test('normalizeLinkUrl accepts bare hostnames and rejects unsafe schemes', () => {
  assert.equal(normalizeLinkUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeLinkUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeLinkUrl('javascript:alert(1)'), '')
})

test('bodyContainsCidImage detects matching cid references', () => {
  assert.equal(bodyContainsCidImage('<img src="cid:hero-image" alt="Hero">', 'hero-image'), true)
  assert.equal(bodyContainsCidImage('<img src="cid:other-image" alt="Other">', 'hero-image'), false)
})
