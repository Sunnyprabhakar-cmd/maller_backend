import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bodyContainsCidImage,
  buildReceiverPreview,
  normalizeLinkUrl,
  renderTemplateForPreview,
  resolveCampaignImageSrc,
  resolvePreviewBodyCidImages
} from './preview-utils'

test('normalizeLinkUrl adds https and rejects unsafe protocols', () => {
  assert.equal(normalizeLinkUrl('example.com/path'), 'https://example.com/path')
  assert.equal(normalizeLinkUrl('https://safe.example.com'), 'https://safe.example.com/')
  assert.equal(normalizeLinkUrl('javascript:alert(1)'), '')
})

test('renderTemplateForPreview substitutes known placeholders', () => {
  const output = renderTemplateForPreview('Hi {{name}} from {{company_name}}', {
    companyName: 'Acme Studio'
  })
  assert.equal(output, 'Hi Jordan Lee from Acme Studio')
})

test('resolveCampaignImageSrc prefers cid file paths and falls back when missing', () => {
  const campaign = {
    logoCid: 'logo-1',
    logoPath: '/tmp/logo.png',
    cidAssets: [{ cid: 'body-1', filePath: '/tmp/body.png', fileName: 'body.png' }]
  }
  assert.equal(
    resolveCampaignImageSrc(campaign, undefined, 'cid', 'logo-1', 'missing-image', 'missing-cid'),
    'file:///tmp/logo.png'
  )
  assert.equal(
    resolveCampaignImageSrc({}, undefined, 'cid', 'missing', 'missing-image', 'missing-cid'),
    'missing-cid'
  )
  assert.equal(
    resolveCampaignImageSrc({}, '', 'url', undefined, 'missing-image', 'missing-cid'),
    'missing-image'
  )
})

test('resolvePreviewBodyCidImages rewrites cid image sources', () => {
  const html = '<p><img src="cid:body-1" alt="hero" /></p>'
  const output = resolvePreviewBodyCidImages(html, {
    cidAssets: [{ cid: 'body-1', filePath: '/tmp/body.png', fileName: 'body.png' }]
  }, 'missing-cid')
  assert.match(output, /src="file:\/\/\/tmp\/body\.png"/)
})

test('bodyContainsCidImage detects matching cid image tags', () => {
  const html = '<img src="cid:banner-main" alt="Banner" />'
  assert.equal(bodyContainsCidImage(html, 'banner-main'), true)
  assert.equal(bodyContainsCidImage(html, 'other'), false)
})

test('buildReceiverPreview renders campaign data and social links', () => {
  const html = buildReceiverPreview({
    campaign: {
      subject: 'Hello {{name}}',
      htmlBody: '<p>Welcome {{name}}</p>',
      senderEmail: 'team@example.com',
      companyName: 'Acme Studio',
      headerCompanyName: 'Acme Studio',
      footerCompanyName: 'Acme Studio',
      companyAddress: '123 Market Street',
      companyContact: 'support@example.com',
      contactNumber: '+1-555-1234',
      facebookUrl: 'https://facebook.com/acme',
      socialIconSize: 32
    },
    previewMode: 'mobile',
    socialIconUrls: { facebook: 'https://cdn.example.com/facebook.png' },
    emptyHtmlBody: '<p>Fallback</p>',
    imageMissingDataUri: 'missing-image',
    cidImageMissingDataUri: 'missing-cid'
  })

  assert.match(html, /max-width:390px/)
  assert.match(html, /Subject:<\/strong> Hello Jordan Lee/)
  assert.match(html, /Welcome Jordan Lee/)
  assert.match(html, /https:\/\/facebook\.com\/acme/)
  assert.match(html, /support@example\.com/)
})
