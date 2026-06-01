// emailSerializer.ts — converts an ordered block array into email-client-safe
// inline-styled HTML. Uses table-based layout (no flexbox/grid) and web-safe
// font stacks, with the brand display/mono fonts as progressive enhancement.
// Survives Gmail, Apple Mail, and Outlook 2019+.

export type BlockType = 'header' | 'hero' | 'text' | 'button' | 'image' | 'divider' | 'footer'

export interface Block {
  id:    string
  type:  BlockType
  props: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────
// Per-block serializers
// ─────────────────────────────────────────────────────────────────────
function td(content: string, style = ''): string {
  return `<td style="${style}">${content}</td>`
}

function row(content: string, bg = '#050C14'): string {
  return `
<tr><td align="center" bgcolor="${bg}" style="padding:0;">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
    <tr>${content}</tr>
  </table>
</td></tr>`
}

function headerBlock(p: Record<string, unknown>): string {
  const name    = String(p.brandName ?? 'VANTAGE')
  const tagline = String(p.tagline ?? '')
  const accent  = String(p.accent ?? '#00C4E8')
  return row(
    td(`
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:20px 32px;border-bottom:1px solid #13263A;">
            <span style="font-family:'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:0.2em;color:#C8DCF0;">${name}</span>
            ${tagline ? `<span style="font-family:'Share Tech Mono','Courier New',monospace;font-size:11px;color:${accent};letter-spacing:0.2em;margin-left:12px;">${tagline}</span>` : ''}
          </td>
        </tr>
      </table>
    `, 'padding:0;'),
    '#091625',
  )
}

function heroBlock(p: Record<string, unknown>): string {
  const heading = String(p.heading ?? '')
  const sub     = String(p.sub ?? '')
  const accent  = String(p.accent ?? '#00C4E8')
  return row(
    td(`
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:40px 32px 36px;border-left:4px solid ${accent};">
          <h1 style="margin:0 0 14px;font-family:'Bebas Neue',Impact,sans-serif;font-size:48px;line-height:1.0;letter-spacing:0.02em;color:#C8DCF0;">${heading}</h1>
          ${sub ? `<p style="margin:0;font-family:'Barlow Condensed','Roboto Condensed',Arial,sans-serif;font-size:18px;line-height:1.5;color:#8BA4BC;">${sub}</p>` : ''}
        </td></tr>
      </table>
    `, 'padding:0;'),
    '#050C14',
  )
}

function textBlock(p: Record<string, unknown>): string {
  const content = String(p.content ?? '')
  const lines   = content.split('\n').map((l) => l.trim()).filter(Boolean)
  const html    = lines.map((l) => `<p style="margin:0 0 12px;font-family:'Barlow Condensed','Roboto Condensed',Arial,sans-serif;font-size:16px;line-height:1.6;color:#8BA4BC;">${l}</p>`).join('')
  return row(
    td(`<table width="100%"><tr><td style="padding:24px 32px;">${html}</td></tr></table>`, 'padding:0;'),
    '#091625',
  )
}

function buttonBlock(p: Record<string, unknown>): string {
  const label  = String(p.label ?? 'Read more')
  const url    = String(p.url ?? '#')
  const accent = String(p.accent ?? '#00C4E8')
  return row(
    td(`
      <table width="100%"><tr><td style="padding:24px 32px;text-align:center;">
        <a href="${url}" style="display:inline-block;background:transparent;border:2px solid ${accent};color:${accent};font-family:'Bebas Neue',Impact,sans-serif;font-size:16px;letter-spacing:0.2em;text-decoration:none;padding:12px 32px;">${label}</a>
      </td></tr></table>
    `, 'padding:0;'),
    '#050C14',
  )
}

function imageBlock(p: Record<string, unknown>): string {
  const src = String(p.src ?? '')
  const alt = String(p.alt ?? '')
  if (!src) return ''
  return row(
    td(`<table width="100%"><tr><td style="padding:0;"><img src="${src}" alt="${alt}" width="600" style="display:block;max-width:100%;border:0;" /></td></tr></table>`, 'padding:0;'),
    '#050C14',
  )
}

function dividerBlock(p: Record<string, unknown>): string {
  const color = String(p.color ?? '#13263A')
  return row(
    td(`<table width="100%"><tr><td style="padding:8px 0;"><hr style="border:none;border-top:1px solid ${color};margin:0;" /></td></tr></table>`, 'padding:0;'),
    '#050C14',
  )
}

function footerBlock(p: Record<string, unknown>): string {
  const domain    = String(p.domain ?? 'vantage.nexus')
  const unsubLink = String(p.unsubLink ?? '#')
  return row(
    td(`
      <table width="100%"><tr><td style="padding:24px 32px;border-top:2px solid #13263A;">
        <p style="margin:0 0 6px;font-family:'Share Tech Mono','Courier New',monospace;font-size:10px;color:#4A6880;letter-spacing:0.16em;">${domain}</p>
        <p style="margin:0;font-family:'Share Tech Mono','Courier New',monospace;font-size:10px;color:#4A6880;letter-spacing:0.1em;">
          <a href="${unsubLink}" style="color:#4A6880;">Unsubscribe</a> · © ${new Date().getFullYear()} BioLoop Nexus
        </p>
      </td></tr></table>
    `, 'padding:0;'),
    '#091625',
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main serializer
// ─────────────────────────────────────────────────────────────────────
export function serializeToHtml(blocks: Block[]): string {
  const blockHtml = blocks.map((b) => {
    switch (b.type) {
      case 'header':  return headerBlock(b.props)
      case 'hero':    return heroBlock(b.props)
      case 'text':    return textBlock(b.props)
      case 'button':  return buttonBlock(b.props)
      case 'image':   return imageBlock(b.props)
      case 'divider': return dividerBlock(b.props)
      case 'footer':  return footerBlock(b.props)
      default:        return ''
    }
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Email</title>
</head>
<body style="margin:0;padding:0;background-color:#050C14;-webkit-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#050C14">
${blockHtml}
</table>
</body>
</html>`
}
