import { useState } from 'react'

interface ChainIconProps {
  src: string
  name: string
  size?: number
  badge?: string
}

/** Remote logo with an initial-letter fallback so a dead CDN never leaves a hole. */
export function ChainIcon({ src, name, size = 28, badge }: ChainIconProps) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="chain-icon" style={{ width: size, height: size }}>
      {failed ? (
        <span className="chain-icon__fallback" aria-hidden="true">{name.charAt(0)}</span>
      ) : (
        <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} />
      )}
      {badge && <img className="chain-icon__badge" src={badge} alt="" width={size * 0.5} height={size * 0.5} />}
    </span>
  )
}
