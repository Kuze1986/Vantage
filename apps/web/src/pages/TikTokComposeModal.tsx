import React from 'react'
import { vantageApi, type TikTokCreatorInfo, type TikTokPostSettings } from '../api/vantage'
import { Button } from '../ds'

/**
 * TikTok Direct Post compose form.
 *
 * Every control here is mandated by TikTok's Content Sharing Guidelines and is
 * checked during app review — see docs/tiktok-app-review.md §3b. In particular:
 *
 *   - creator info is fetched live each time this opens, never cached
 *   - the privacy level has NO default; the user must pick one
 *   - interaction toggles default to off, and are greyed out when the creator's
 *     own account settings disable them
 *   - commercial disclosure defaults to off and changes the declaration text
 *   - branded content may not be private
 *   - the video is previewed before posting
 *
 * Do not "simplify" any of these away.
 */

const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE:    'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR:   'Followers',
  SELF_ONLY:             'Only you',
}

const TITLE_MAX = 2200

type Props = {
  pieceId: string
  videoUrl: string | null
  initialTitle: string
  /** Existing settings when re-opening a piece that was already composed. */
  initial?: Partial<TikTokPostSettings>
  onClose: () => void
  onPublished: (publishId: string) => void
}

export function TikTokComposeModal({ pieceId, videoUrl, initialTitle, initial, onClose, onPublished }: Props) {
  const [creator, setCreator] = React.useState<TikTokCreatorInfo | null>(null)
  const [loadErr, setLoadErr] = React.useState<string | null>(null)
  const [err, setErr]         = React.useState<string | null>(null)
  const [busy, setBusy]       = React.useState(false)
  const [progress, setProgress] = React.useState<string | null>(null)

  const [title, setTitle] = React.useState(initial?.title ?? initialTitle ?? '')
  // No default: null until the user actively chooses. This is a hard TikTok rule.
  const [privacy, setPrivacy] = React.useState<string | null>(initial?.privacy_level ?? null)
  // Interaction toggles are expressed as "allowed" in the UI but sent as
  // "disable_*" — defaulting to off means everything starts disabled.
  const [allowComment, setAllowComment] = React.useState(initial ? !initial.disable_comment : false)
  const [allowDuet,    setAllowDuet]    = React.useState(initial ? !initial.disable_duet : false)
  const [allowStitch,  setAllowStitch]  = React.useState(initial ? !initial.disable_stitch : false)

  const [commercial, setCommercial] = React.useState(
    !!(initial?.brand_organic_toggle || initial?.brand_content_toggle),
  )
  const [yourBrand, setYourBrand]     = React.useState(!!initial?.brand_organic_toggle)
  const [brandedContent, setBranded]  = React.useState(!!initial?.brand_content_toggle)
  const [isAigc, setIsAigc]           = React.useState(initial?.is_aigc ?? true)
  const [duration, setDuration]       = React.useState<number | null>(null)

  React.useEffect(() => {
    let alive = true
    vantageApi.getTikTokCreatorInfo()
      .then((r) => { if (alive) setCreator(r.creator) })
      .catch((e) => { if (alive) setLoadErr(String((e as Error).message)) })
    return () => { alive = false }
  }, [])

  // Branded content cannot be private. Rather than silently rewriting the user's
  // choice, the option is disabled below and an already-selected private level
  // is cleared so they must consciously pick again.
  React.useEffect(() => {
    if (brandedContent && privacy === 'SELF_ONLY') setPrivacy(null)
  }, [brandedContent, privacy])

  const options = creator?.privacy_level_options ?? []
  const disclosureInvalid = commercial && !yourBrand && !brandedContent
  // Guidelines require validating the video against the account's own cap
  // before allowing a post, rather than letting TikTok reject it after upload.
  const tooLong = !!(creator?.max_video_post_duration_sec && duration && duration > creator.max_video_post_duration_sec)
  const canSubmit = !!privacy && !!creator && !busy && !disclosureInvalid && !tooLong && title.length <= TITLE_MAX

  const declaration = brandedContent
    ? 'By posting, you agree to TikTok’s Branded Content Policy and Music Usage Confirmation.'
    : yourBrand
      ? 'By posting, you agree to TikTok’s Music Usage Confirmation.'
      : null

  async function submit() {
    if (!privacy) return
    setBusy(true); setErr(null); setProgress('Saving settings…')
    const settings: TikTokPostSettings = {
      title,
      privacy_level: privacy,
      disable_comment: !allowComment,
      disable_duet:    !allowDuet,
      disable_stitch:  !allowStitch,
      brand_organic_toggle: commercial && yourBrand,
      brand_content_toggle: commercial && brandedContent,
      is_aigc: isAigc,
    }
    try {
      // Persist first so a scheduled publish replays exactly what was chosen
      // here, and so a failed post can be retried without re-composing.
      await vantageApi.patchQueuePiece(pieceId, { content_payload_patch: { tiktok_post_settings: settings } })
      setProgress('Uploading to TikTok…')
      const res = await vantageApi.publish('tiktok', pieceId)
      const publishId = res.external_post_id
      setProgress('TikTok is processing your video. This can take a few minutes…')
      await pollStatus(publishId)
      onPublished(publishId)
    } catch (e) {
      setErr(String((e as Error).message))
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  async function pollStatus(publishId: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const s = await vantageApi.getTikTokPublishStatus(publishId)
        if (s.status === 'PUBLISH_COMPLETE') { setProgress('Published to TikTok.'); return }
        if (s.status === 'FAILED') throw new Error(`TikTok rejected the post: ${s.fail_reason ?? 'unknown reason'}`)
        setProgress(`TikTok is processing your video (${s.status.toLowerCase().replace(/_/g, ' ')})…`)
      } catch (e) {
        // A transient status-poll failure shouldn't look like a failed post —
        // the upload already succeeded at this point.
        if (String((e as Error).message).includes('rejected')) throw e
      }
    }
    setProgress('Still processing on TikTok’s side — it will appear on the profile shortly.')
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Post to TikTok">
      <div style={sheet}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontFamily: 'var(--nx-mono)', letterSpacing: '0.08em' }}>POST TO TIKTOK</h2>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        {loadErr && (
          <p style={errStyle}>
            Couldn’t load your TikTok account details: {loadErr}
            <br />Reconnect the channel on the Channels page and try again.
          </p>
        )}
        {!creator && !loadErr && <p style={{ opacity: 0.6, fontSize: 12 }}>Loading your TikTok account…</p>}

        {creator && (
          <>
            {/* Creator identity — required so the user knows which account receives the post. */}
            <div style={creatorRow}>
              {creator.creator_avatar_url
                ? <img src={creator.creator_avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--nx-surface-3)' }} />}
              <div>
                <div style={{ fontSize: 13 }}>{creator.creator_nickname}</div>
                {creator.creator_username && (
                  <div style={{ fontSize: 11, opacity: 0.6 }}>@{creator.creator_username}</div>
                )}
              </div>
            </div>

            {/* Preview — guidelines require showing the content before publishing. */}
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                style={{ width: '100%', maxHeight: 320, borderRadius: 6, background: '#000', marginBottom: 8 }}
              />
            )}
            {tooLong && (
              <p style={{ ...errStyle, marginTop: 0, marginBottom: 12 }}>
                This video is {Math.round(duration!)}s, but this account can post at most{' '}
                {creator.max_video_post_duration_sec}s. Shorten it before posting.
              </p>
            )}

            <label style={label}>Caption</label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={3}
              style={textarea}
              placeholder="Write a caption…"
            />
            <div style={{ fontSize: 10, opacity: 0.55, textAlign: 'right', marginBottom: 14 }}>
              {title.length} / {TITLE_MAX}
            </div>

            <label style={label}>Who can view this video</label>
            <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
              {options.map((opt) => {
                // Branded content may not be private.
                const blocked = brandedContent && opt === 'SELF_ONLY'
                return (
                  <label key={opt} style={{ ...radioRow, opacity: blocked ? 0.4 : 1 }}>
                    <input
                      type="radio"
                      name="tt-privacy"
                      checked={privacy === opt}
                      disabled={blocked}
                      onChange={() => setPrivacy(opt)}
                    />
                    <span>{PRIVACY_LABELS[opt] ?? opt}</span>
                    {blocked && <span style={{ fontSize: 10, opacity: 0.7 }}>— not available for branded content</span>}
                  </label>
                )
              })}
              {!privacy && (
                <p style={{ fontSize: 11, color: 'var(--nx-amber, #e0a800)' }}>
                  Choose who can view this video before posting.
                </p>
              )}
            </div>

            <label style={label}>Allow users to</label>
            <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
              <Toggle label="Comment" checked={allowComment} disabled={creator.comment_disabled}
                      onChange={setAllowComment} note={creator.comment_disabled ? 'disabled on your account' : undefined} />
              <Toggle label="Duet" checked={allowDuet} disabled={creator.duet_disabled}
                      onChange={setAllowDuet} note={creator.duet_disabled ? 'disabled on your account' : undefined} />
              <Toggle label="Stitch" checked={allowStitch} disabled={creator.stitch_disabled}
                      onChange={setAllowStitch} note={creator.stitch_disabled ? 'disabled on your account' : undefined} />
            </div>

            <Toggle label="Disclose video content" checked={commercial} onChange={setCommercial} />
            <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 10px' }}>
              Turn on to declare that this video promotes a brand, product or service.
            </p>

            {commercial && (
              <div style={{ display: 'grid', gap: 6, marginBottom: 12, paddingLeft: 12, borderLeft: '2px solid var(--nx-surface-3)' }}>
                <Toggle label="Your brand" checked={yourBrand} onChange={setYourBrand}
                        note="labels this video as Promotional content" />
                <Toggle label="Branded content" checked={brandedContent} onChange={setBranded}
                        note="labels this video as Paid partnership" />
                {disclosureInvalid && (
                  <p style={{ fontSize: 11, color: 'var(--nx-amber, #e0a800)' }}>
                    Select at least one disclosure type, or turn the disclosure off.
                  </p>
                )}
              </div>
            )}

            <Toggle label="AI-generated content" checked={isAigc} onChange={setIsAigc}
                    note="this video was produced with generative tools" />

            {declaration && (
              <p style={{ fontSize: 11, opacity: 0.75, marginTop: 14, lineHeight: 1.6 }}>{declaration}</p>
            )}

            {progress && <p style={{ fontSize: 12, marginTop: 14, color: 'var(--nx-cyan)' }}>{progress}</p>}
            {err && <p style={errStyle}>{err}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Button label="Cancel" variant="ghost" onClick={onClose} disabled={busy} />
              <Button
                label={busy ? 'Posting…' : 'Post to TikTok'}
                onClick={() => { void submit() }}
                disabled={!canSubmit}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled, note }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string
}) {
  return (
    <label style={{ ...radioRow, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {note && <span style={{ fontSize: 10, opacity: 0.7 }}>— {note}</span>}
    </label>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px',
}
const sheet: React.CSSProperties = {
  background: 'var(--nx-surface-1, #14161a)', border: '1px solid var(--nx-surface-3, #2a2e35)',
  borderRadius: 8, padding: 24, width: '100%', maxWidth: 480,
  fontFamily: 'var(--nx-sans, system-ui)', color: 'var(--nx-text-1, #e5e5e5)',
}
const label: React.CSSProperties = {
  display: 'block', fontSize: 10, fontFamily: 'var(--nx-mono)', letterSpacing: '0.1em',
  textTransform: 'uppercase', opacity: 0.6, marginBottom: 6,
}
const textarea: React.CSSProperties = {
  width: '100%', background: 'var(--nx-surface-2, #1b1e24)', color: 'inherit',
  border: '1px solid var(--nx-surface-3, #2a2e35)', borderRadius: 4, padding: 10,
  fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
}
const radioRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }
const creatorRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
  padding: 10, background: 'var(--nx-surface-2, #1b1e24)', borderRadius: 6,
}
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }
const errStyle: React.CSSProperties = { fontSize: 12, color: 'var(--nx-red, #ff5555)', marginTop: 12, lineHeight: 1.6 }
