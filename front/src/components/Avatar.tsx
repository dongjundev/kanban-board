import { avatarColor, initials } from '../utils'

interface AvatarProps {
  name: string
  size?: number
}

export function Avatar({ name, size = 24 }: AvatarProps) {
  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(name) }}
    >
      {initials(name)}
    </span>
  )
}
