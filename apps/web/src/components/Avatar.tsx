import type { AvatarMap, ParticipantKind } from '@claude-codex/protocol';

const GLYPH: Record<ParticipantKind, string> = { user: '나', claude: '✳', codex: '⬢' };

/** 참가자 아바타. 업로드한 이미지가 있으면 픽셀 그대로, 없으면 색 배경 + 글리프 */
export function Avatar({ kind, avatars, size, className = '' }: { kind: ParticipantKind; avatars: AvatarMap; size?: number; className?: string }) {
  const v = avatars[kind];
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.45) } : undefined;
  if (v) return <img className={`avatar img ${kind} ${className}`} style={style} src={`/avatars/${kind}?v=${v}`} alt={kind} draggable={false} />;
  return <span className={`avatar ${kind} ${className}`} style={style}>{GLYPH[kind]}</span>;
}
